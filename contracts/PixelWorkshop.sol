// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// BOT Bazaar pixel workshop — free on-chain design creation and a public gallery.
///
/// A design is an 8x8 pixel pattern in 4 colours: 16 bytes of pixels (2 bits each) plus four
/// 4-bit preset palette indices, all stored on-chain (no file hosting, no IPFS pinning).
/// Creating is free (gas only). A creator may optionally set a price; buyers then pay the creator
/// directly with no intermediary. A design is a creative good, not a gameplay reward, so selling it
/// is allowed; owning a copy is a non-transferable right to display it (setProfileDesign).
/// A free-only deployment (the first mainnet version) refuses any price, so no BOT moves through it.
contract PixelWorkshop {
    bool public immutable freeOnly;

    struct Design {
        address payable creator;
        uint64 createdAt;
        uint32 mints;
        uint128 price; // 0 = free to collect
        uint16 palette; // 4 x 4-bit preset colour index
        bytes16 pixels; // 8x8 x 2 bit, row-major
        string name;
    }

    Design[] private _designs;
    mapping(uint256 => mapping(address => bool)) private _owned;
    mapping(address => uint256) private _profile; // designId + 1 (0 = none)

    event DesignRegistered(uint256 indexed id, address indexed creator, string name, uint256 price);
    event DesignCollected(uint256 indexed id, address indexed collector, address indexed creator, uint256 price);
    event ProfileDesignSet(address indexed who, uint256 idPlus1);

    error WrongPrice(uint256 expected, uint256 sent);

    constructor(bool freeOnly_) {
        freeOnly = freeOnly_;
    }

    function register(
        string calldata name,
        bytes16 pixels,
        uint16 palette,
        uint128 price
    ) external returns (uint256 id) {
        require(bytes(name).length >= 1 && bytes(name).length <= 36, "name");
        require(price == 0 || !freeOnly, "free-only");
        id = _designs.length;
        _designs.push(
            Design(payable(msg.sender), uint64(block.timestamp), 0, price, palette, pixels, name)
        );
        _owned[id][msg.sender] = true; // the creator owns it automatically
        emit DesignRegistered(id, msg.sender, name, price);
    }

    /// Collect a design — free ones cost gas only; paid ones go straight to the creator
    function collect(uint256 id) external payable {
        Design storage d = _designs[id];
        require(!_owned[id][msg.sender], "owned");
        if (msg.value != d.price) revert WrongPrice(d.price, msg.value);
        _owned[id][msg.sender] = true;
        d.mints += 1;
        if (msg.value > 0) {
            (bool ok, ) = d.creator.call{value: msg.value}("");
            require(ok, "pay");
        }
        emit DesignCollected(id, msg.sender, d.creator, msg.value);
    }

    /// Show an owned design on your profile (idPlus1 = 0 clears it)
    function setProfileDesign(uint256 idPlus1) external {
        require(idPlus1 == 0 || _owned[idPlus1 - 1][msg.sender], "not-owned");
        _profile[msg.sender] = idPlus1;
        emit ProfileDesignSet(msg.sender, idPlus1);
    }

    function designCount() external view returns (uint256) {
        return _designs.length;
    }

    function designAt(uint256 id) external view returns (Design memory) {
        return _designs[id];
    }

    /// Gallery page, newest first
    function designsPage(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Design[] memory list)
    {
        uint256 n = _designs.length;
        uint256 from = n > offset ? n - offset : 0;
        uint256 count = from > limit ? limit : from;
        ids = new uint256[](count);
        list = new Design[](count);
        for (uint256 i; i < count; i++) {
            uint256 id = from - 1 - i;
            ids[i] = id;
            list[i] = _designs[id];
        }
    }

    function ownedOf(address who, uint256 id) external view returns (bool) {
        return _owned[id][who];
    }

    /// The design shown on a profile — exists=false when none
    function profileDesignOf(address who)
        external
        view
        returns (bool exists, uint256 id, bytes16 pixels, uint16 palette)
    {
        uint256 p1 = _profile[who];
        if (p1 == 0) return (false, 0, 0, 0);
        Design storage d = _designs[p1 - 1];
        return (true, p1 - 1, d.pixels, d.palette);
    }
}
