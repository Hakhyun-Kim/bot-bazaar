// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// BOT Bazaar projects — the layer that lets many projects host their own storefront district on
/// one shared marketplace.
///
/// Anyone can register a project. A shop joins a project by putting its id in openShop; joining
/// needs no approval, so the chain never blocks a seller. What a project owner controls is only its
/// own curation: featured shops, which its frontend shows first. There is no fee and no admin key.
contract BazaarProjects {
    struct Project {
        address owner;
        uint64 createdAt;
        string name;
        string metadataURI; // https:// or ipfs:// JSON: logo, website, description, contact
    }

    Project[] private _projects; // id = index + 1, so 0 can mean "independent" in BazaarMarket
    mapping(uint256 => mapping(address => bool)) public featured;
    mapping(uint256 => address[]) private _featuredList;
    mapping(uint256 => mapping(address => uint256)) private _featuredIndex; // position + 1

    event ProjectRegistered(uint256 indexed id, address indexed owner, string name);
    event ProjectUpdated(uint256 indexed id, string name, string metadataURI);
    event ProjectTransferred(uint256 indexed id, address indexed from, address indexed to);
    event Featured(uint256 indexed id, address indexed shop, bool on);

    function register(string calldata name, string calldata metadataURI) external returns (uint256 id) {
        _check(name, metadataURI);
        _projects.push(Project(msg.sender, uint64(block.timestamp), name, metadataURI));
        id = _projects.length;
        emit ProjectRegistered(id, msg.sender, name);
    }

    function update(uint256 id, string calldata name, string calldata metadataURI) external {
        Project storage p = _own(id);
        _check(name, metadataURI);
        p.name = name;
        p.metadataURI = metadataURI;
        emit ProjectUpdated(id, name, metadataURI);
    }

    function transfer(uint256 id, address to) external {
        Project storage p = _own(id);
        require(to != address(0), "to0");
        emit ProjectTransferred(id, p.owner, to);
        p.owner = to;
    }

    /// Curation only — showing a shop first on this project's frontend. Joining is not gated.
    function setFeatured(uint256 id, address shop, bool on) external {
        _own(id);
        if (featured[id][shop] == on) return;
        featured[id][shop] = on;
        address[] storage list = _featuredList[id];
        if (on) {
            list.push(shop);
            _featuredIndex[id][shop] = list.length;
        } else {
            uint256 pos = _featuredIndex[id][shop] - 1;
            address last = list[list.length - 1];
            list[pos] = last;
            _featuredIndex[id][last] = pos + 1;
            list.pop();
            delete _featuredIndex[id][shop];
        }
        emit Featured(id, shop, on);
    }

    function projectCount() external view returns (uint256) {
        return _projects.length;
    }

    function projectOf(uint256 id) external view returns (Project memory) {
        require(id >= 1 && id <= _projects.length, "id");
        return _projects[id - 1];
    }

    /// Newest first, from offset, at most limit
    function projectsPage(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Project[] memory list)
    {
        uint256 n = _projects.length;
        uint256 from = n > offset ? n - offset : 0;
        uint256 count = from > limit ? limit : from;
        ids = new uint256[](count);
        list = new Project[](count);
        for (uint256 i; i < count; i++) {
            ids[i] = from - i;
            list[i] = _projects[from - 1 - i];
        }
    }

    function featuredOf(uint256 id) external view returns (address[] memory) {
        return _featuredList[id];
    }

    function _own(uint256 id) private view returns (Project storage p) {
        require(id >= 1 && id <= _projects.length, "id");
        p = _projects[id - 1];
        require(p.owner == msg.sender, "owner");
    }

    function _check(string calldata name, string calldata uri) private pure {
        require(bytes(name).length >= 1 && bytes(name).length <= 48, "name");
        require(bytes(uri).length <= 200, "uri");
    }
}
