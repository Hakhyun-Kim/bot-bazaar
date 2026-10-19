// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC1155Receiver {
    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external returns (bytes4);
}

/// BOT Bazaar market — shops, listings, escrowed purchases and receipt tokens on BOT Chain.
///
/// Core rules:
/// - Prices are enforced on-chain: buy() only takes listed items, buyItem() only shop prices.
///   Anything without a fixed price goes through BazaarOffers (haggling) via purchaseFor, whose
///   caller is fixed once at deployment (no setter).
/// - Every purchase sits in escrow for 24 h (7 days if the buyer disputes). The buyer confirms,
///   the seller refunds, or anyone releases after the deadline. There is no keeper, no timer.
/// - The receipt (ERC-1155) is minted to the buyer only on settlement, so a refunded buyer never
///   holds both the money and the receipt. Receipts can be redeemed (burned) as proof of use.
/// Multi-tenant marketplace:
/// - A shop has a category (B2C goods / B2B service / developer asset / agent service), an
///   optional project id (see BazaarProjects) and a metadata URI, and up to 8 items.
/// - No platform fee and no admin key. Payments are native BOT only in v1.
/// What is deliberately absent: fungible tokens, order books, financial products.
contract BazaarMarket {
    /// Version 1.0: fixes L-1 to L-4 and L-6 of docs/audit/internal-review.md (see docs/audit/v1.md)
    string public constant VERSION = "1.0";
    // ---------- ERC-1155 (minimal) ----------
    event TransferSingle(
        address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value
    );
    event TransferBatch(
        address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values
    );
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);

    mapping(uint256 => mapping(address => uint256)) private _balances;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    function balanceOf(address account, uint256 id) public view returns (uint256) {
        return _balances[id][account];
    }

    function balanceOfBatch(
        address[] calldata accounts,
        uint256[] calldata ids
    ) external view returns (uint256[] memory out) {
        require(accounts.length == ids.length, "len");
        out = new uint256[](accounts.length);
        for (uint256 i; i < accounts.length; i++) {
            out[i] = _balances[ids[i]][accounts[i]];
        }
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address account, address operator) public view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    function _move(address from, address to, uint256 id, uint256 value) private {
        uint256 b = _balances[id][from];
        require(b >= value, "bal");
        unchecked {
            _balances[id][from] = b - value;
        }
        _balances[id][to] += value;
    }

    function safeTransferFrom(
        address from, address to, uint256 id, uint256 value, bytes calldata data
    ) external {
        require(from == msg.sender || _operatorApprovals[from][msg.sender], "auth");
        require(to != address(0), "to0");
        _move(from, to, id, value);
        emit TransferSingle(msg.sender, from, to, id, value);
        _checkReceiver(from, to, id, value, data);
    }

    function safeBatchTransferFrom(
        address from, address to, uint256[] calldata ids, uint256[] calldata values, bytes calldata data
    ) external {
        require(from == msg.sender || _operatorApprovals[from][msg.sender], "auth");
        require(to != address(0), "to0");
        require(ids.length == values.length, "len");
        for (uint256 i; i < ids.length; i++) _move(from, to, ids[i], values[i]);
        emit TransferBatch(msg.sender, from, to, ids, values);
        data; // batch receiver callback is out of scope (EOA-to-EOA transfers assumed)
    }

    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return iid == 0xd9b67a26 || iid == 0x0e89341c || iid == 0x01ffc9a7;
    }

    function _checkReceiver(
        address from, address to, uint256 id, uint256 value, bytes memory data
    ) private {
        if (to.code.length > 0) {
            try IERC1155Receiver(to).onERC1155Received(msg.sender, from, id, value, data)
            returns (bytes4 r) {
                require(r == IERC1155Receiver.onERC1155Received.selector, "rcv");
            } catch {
                revert("rcv");
            }
        }
    }

    /// Offers contract — the deploy script passes the address predicted from the next nonce (no setter)
    address public immutable offers;

    /// Most BOT one purchase or listed price may carry, in wei; 0 = no cap. Set once at deployment
    /// (the mainnet test version uses a tiny cap so a bug can only ever touch small amounts).
    uint128 public immutable maxAmount;

    error OverCap(uint256 cap, uint256 amount);

    constructor(address offers_, uint128 maxAmount_) {
        offers = offers_;
        maxAmount = maxAmount_;
    }

    function _capped(uint256 amount) private view {
        if (maxAmount != 0 && amount > maxAmount) revert OverCap(maxAmount, amount);
    }

    // ---------- receipt metadata (on-chain JSON) ----------
    struct CouponMeta {
        address seller;
        string itemId;
    }

    mapping(uint256 => CouponMeta) private _coupons;

    function tokenIdOf(address seller, string memory itemId) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(seller, itemId)));
    }

    /// Receipt name and seller as a data: URI — no file hosting
    function uri(uint256 id) external view returns (string memory) {
        CouponMeta storage m = _coupons[id];
        require(m.seller != address(0), "id");
        return string.concat(
            "data:application/json;utf8,{\"name\":\"",
            _jsonEscape(m.itemId),
            "\",\"description\":\"BOT Bazaar purchase receipt\",\"seller\":\"",
            _hexAddress(m.seller),
            "\"}"
        );
    }

    function _jsonEscape(string memory s) private pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length * 2);
        uint256 n;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (uint8(c) < 0x20) continue; // drop control characters
            if (c == '"' || c == "\\") out[n++] = "\\";
            out[n++] = c;
        }
        assembly {
            mstore(out, n)
        }
        return string(out);
    }

    function _hexAddress(address a) private pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        uint160 v = uint160(a);
        for (uint256 i; i < 20; i++) {
            uint8 byt = uint8(v >> (8 * (19 - i)));
            out[2 + 2 * i] = hexChars[byt >> 4];
            out[3 + 2 * i] = hexChars[byt & 0x0f];
        }
        return string(out);
    }

    // ---------- listings (programmatic, unlimited per seller) ----------
    struct Listing {
        uint128 price;
        bool active;
    }

    mapping(address => mapping(bytes32 => Listing)) private _listings;

    event Listed(address indexed seller, string itemId, uint256 price);
    event Unlisted(address indexed seller, string itemId);

    error NotListed();
    error WrongPrice(uint256 expected, uint256 sent);

    function list(string calldata itemId, uint128 price) external {
        require(price > 0, "price");
        _capped(price);
        require(bytes(itemId).length >= 1 && bytes(itemId).length <= 48, "name");
        _listings[msg.sender][keccak256(bytes(itemId))] = Listing(price, true);
        emit Listed(msg.sender, itemId, price);
    }

    function unlist(string calldata itemId) external {
        delete _listings[msg.sender][keccak256(bytes(itemId))];
        emit Unlisted(msg.sender, itemId);
    }

    function listingOf(
        address seller,
        string calldata itemId
    ) external view returns (uint256 price, bool active) {
        Listing memory l = _listings[seller][keccak256(bytes(itemId))];
        return (l.price, l.active);
    }

    // ---------- shop registry ----------
    /// Category tags. Frontends may show any subset; the chain only stores the number.
    uint8 public constant CAT_GOODS = 0; // B2C goods: cosmetics, coupons, digital items
    uint8 public constant CAT_SERVICE = 1; // B2B service: integration, audit, design work
    uint8 public constant CAT_DEV_ASSET = 2; // developer assets: SDK licences, templates, data sets
    uint8 public constant CAT_AGENT = 3; // services sold by (or to) autonomous agents
    uint8 public constant CAT_MAX = 3;
    uint256 public constant MAX_ITEMS = 8;

    struct ShopItem {
        string name;
        uint128 price;
    }

    struct Shop {
        string title;
        string metadataURI; // https:// or ipfs:// JSON with logo, description, contact
        uint32 projectId; // 0 = independent; otherwise a BazaarProjects id
        uint8 category;
        uint64 openedAt;
        bool open;
        ShopItem[] items;
    }

    mapping(address => Shop) private _shops;
    address[] private _openOwners; // only open shops; closing swap-and-pops
    mapping(address => uint256) private _openIndex; // position + 1 (0 = closed)

    event ShopOpened(address indexed owner, uint32 indexed projectId, uint8 category, string title);
    event ShopClosed(address indexed owner);

    /// Open or update a shop in one call: title, metadata, project, category and priced items.
    function openShop(
        string calldata title,
        string calldata metadataURI,
        uint32 projectId,
        uint8 category,
        ShopItem[] calldata items
    ) external {
        require(bytes(title).length >= 1 && bytes(title).length <= 60, "title");
        require(bytes(metadataURI).length <= 200, "uri");
        require(category <= CAT_MAX, "category");
        require(items.length >= 1 && items.length <= MAX_ITEMS, "items");
        Shop storage s = _shops[msg.sender];
        s.title = title;
        s.metadataURI = metadataURI;
        s.projectId = projectId;
        s.category = category;
        s.openedAt = uint64(block.timestamp);
        s.open = true;
        delete s.items;
        for (uint256 i; i < items.length; i++) {
            require(items[i].price > 0, "price");
            _capped(items[i].price);
            require(bytes(items[i].name).length >= 1 && bytes(items[i].name).length <= 48, "name");
            s.items.push(items[i]);
        }
        if (_openIndex[msg.sender] == 0) {
            _openOwners.push(msg.sender);
            _openIndex[msg.sender] = _openOwners.length;
        }
        emit ShopOpened(msg.sender, projectId, category, title);
    }

    function closeShop() external {
        Shop storage s = _shops[msg.sender];
        require(s.open, "closed");
        s.open = false;
        _popIndex(_openOwners, _openIndex, msg.sender);
        emit ShopClosed(msg.sender);
    }

    function shopOf(address owner) external view returns (Shop memory) {
        return _shops[owner];
    }

    /// Open shops from offset, at most limit — frontends page through and filter by project/category
    function openShops(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory owners, Shop[] memory data, uint256 total)
    {
        total = _openOwners.length;
        uint256 n = _pageLen(total, offset, limit);
        owners = new address[](n);
        data = new Shop[](n);
        for (uint256 i; i < n; i++) {
            owners[i] = _openOwners[offset + i];
            data[i] = _shops[owners[i]];
        }
    }

    // ---------- escrowed purchases ----------
    struct Purchase {
        address buyer;
        address payable seller;
        uint128 amount;
        uint64 releaseAt;
        bool settled;
        bool disputed;
        uint256 tokenId;
    }

    Purchase[] private _purchases;

    uint64 public constant RELEASE_AFTER = 24 hours;
    uint64 public constant DISPUTE_EXTENSION = 7 days;

    event Purchased(
        address indexed buyer,
        address indexed seller,
        string itemId,
        uint256 amount,
        uint256 indexed purchaseId,
        uint256 tokenId
    );
    event Settled(uint256 indexed purchaseId, address indexed seller, uint256 amount);
    event Disputed(uint256 indexed purchaseId, address indexed buyer);
    event Refunded(uint256 indexed purchaseId, address indexed buyer, uint256 amount);

    function _pushPurchase(
        address buyer,
        address payable seller,
        string memory itemId,
        uint256 amount
    ) private returns (uint256 purchaseId) {
        require(seller != address(0) && seller != buyer, "seller");
        _capped(amount);
        uint256 tid = tokenIdOf(seller, itemId);
        if (_coupons[tid].seller == address(0)) _coupons[tid] = CouponMeta(seller, itemId);
        purchaseId = _purchases.length;
        _purchases.push(
            Purchase(
                buyer,
                seller,
                uint128(amount),
                uint64(block.timestamp) + RELEASE_AFTER,
                false,
                false,
                tid
            )
        );
        emit Purchased(buyer, seller, itemId, amount, purchaseId, tid);
    }

    /// Buy a listed item at exactly its listed price. Unlisted items go through BazaarOffers.
    function buy(
        address payable seller,
        string calldata itemId
    ) external payable returns (uint256 purchaseId) {
        Listing memory l = _listings[seller][keccak256(bytes(itemId))];
        if (!l.active) revert NotListed();
        if (msg.value != l.price) revert WrongPrice(l.price, msg.value);
        return _pushPurchase(msg.sender, seller, itemId, msg.value);
    }

    /// Called only by the offers contract when a seller accepts; the value is the accepted offer
    function purchaseFor(
        address buyer,
        address payable seller,
        string calldata itemId
    ) external payable returns (uint256 purchaseId) {
        require(msg.sender == offers, "offers");
        require(msg.value > 0 && msg.value <= type(uint128).max, "value");
        return _pushPurchase(buyer, seller, itemId, msg.value);
    }

    /// Buy item `index` of an open shop at exactly the shop's on-chain price. The buyer names the
    /// item too, so a shop that swaps the item at that index in the meantime is refused (L-3).
    function buyItem(
        address payable seller,
        uint8 index,
        string calldata itemName
    ) external payable returns (uint256 purchaseId) {
        Shop storage s = _shops[seller];
        require(s.open && index < s.items.length, "item");
        require(keccak256(bytes(s.items[index].name)) == keccak256(bytes(itemName)), "item changed");
        if (msg.value != s.items[index].price) {
            revert WrongPrice(s.items[index].price, msg.value);
        }
        return _pushPurchase(msg.sender, seller, s.items[index].name, msg.value);
    }

    /// Buyer confirms: payment to the seller, receipt to the buyer
    function confirm(uint256 purchaseId) external {
        Purchase storage p = _purchases[purchaseId];
        require(msg.sender == p.buyer, "buyer");
        _settle(purchaseId, p);
    }

    /// After the deadline (24 h, or 7 days if disputed) anyone may settle — protects sellers
    function release(uint256 purchaseId) external {
        Purchase storage p = _purchases[purchaseId];
        require(block.timestamp >= p.releaseAt, "early");
        _settle(purchaseId, p);
    }

    /// Settle many at once; skips unknown, early or finished ones and returns how many settled.
    /// A payout never reverts (see _send), so one bad id or payee cannot sink the batch (L-2).
    function releaseMany(uint256[] calldata ids) external returns (uint256 done) {
        for (uint256 i; i < ids.length; i++) {
            if (ids[i] >= _purchases.length) continue;
            Purchase storage p = _purchases[ids[i]];
            if (p.settled || block.timestamp < p.releaseAt) continue;
            _settle(ids[i], p);
            done++;
        }
    }

    /// Buyer disputes before the deadline: it moves out to 7 days so both sides can talk.
    /// The buyer can still confirm, and the seller can still refund.
    function dispute(uint256 purchaseId) external {
        Purchase storage p = _purchases[purchaseId];
        require(msg.sender == p.buyer, "buyer");
        require(!p.settled && !p.disputed, "state");
        require(block.timestamp < p.releaseAt, "late"); // L-4: same rule as BazaarRequests
        p.disputed = true;
        uint64 extended = uint64(block.timestamp) + DISPUTE_EXTENSION;
        if (extended > p.releaseAt) p.releaseAt = extended;
        emit Disputed(purchaseId, msg.sender);
    }

    /// Seller refunds. No receipt exists yet because it is only minted on settlement.
    function refund(uint256 purchaseId) external {
        Purchase storage p = _purchases[purchaseId];
        require(msg.sender == p.seller, "seller");
        require(!p.settled, "settled");
        p.settled = true;
        _send(p.buyer, p.amount);
        emit Refunded(purchaseId, p.buyer, p.amount);
    }

    function _settle(uint256 id, Purchase storage p) private {
        require(!p.settled, "settled");
        p.settled = true;
        _balances[p.tokenId][p.buyer] += 1;
        emit TransferSingle(msg.sender, address(0), p.buyer, p.tokenId, 1);
        _send(p.seller, p.amount);
        emit Settled(id, p.seller, p.amount);
        // No receiver callback: a buyer contract that rejects must not block the seller's payout
    }

    function purchaseOf(
        uint256 id
    )
        external
        view
        returns (
            address buyer,
            address seller,
            uint256 amount,
            uint64 releaseAt,
            bool settled,
            bool disputed,
            uint256 tokenId
        )
    {
        Purchase memory p = _purchases[id];
        return (p.buyer, p.seller, p.amount, p.releaseAt, p.settled, p.disputed, p.tokenId);
    }

    function purchaseCount() external view returns (uint256) {
        return _purchases.length;
    }

    // ---------- payouts (v1.0, L-1) ----------
    /// A push payment that fails (a payee contract that rejects BOT, or needs more than PUSH_GAS)
    /// no longer blocks settlement: the amount is credited here and the payee pulls it with
    /// withdraw(). The escrow always settles; nobody else can take what is owed.
    uint256 private constant PUSH_GAS = 100_000;
    mapping(address => uint256) public owed;
    uint256 public totalOwed;

    event Owed(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    function _send(address to, uint256 amount) private {
        bool ok;
        assembly {
            ok := call(PUSH_GAS, to, amount, 0, 0, 0, 0) // no return data copied
        }
        if (!ok) {
            owed[to] += amount;
            totalOwed += amount;
            emit Owed(to, amount);
        }
    }

    function withdraw() external {
        uint256 amount = owed[msg.sender];
        require(amount > 0, "nothing owed");
        owed[msg.sender] = 0;
        totalOwed -= amount;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "send");
        emit Withdrawn(msg.sender, amount);
    }

    // ---------- redeem (burn) ----------
    event Redeemed(address indexed who, uint256 indexed id, uint256 value);

    /// Burn a receipt as on-chain proof of use (merchants verify the Redeemed event)
    function redeem(uint256 id, uint256 value) external {
        uint256 b = _balances[id][msg.sender];
        require(value > 0 && b >= value, "bal");
        unchecked {
            _balances[id][msg.sender] = b - value;
        }
        emit TransferSingle(msg.sender, msg.sender, address(0), id, value);
        emit Redeemed(msg.sender, id, value);
    }

    // ---------- helpers ----------
    function _pageLen(uint256 total, uint256 offset, uint256 limit) private pure returns (uint256) {
        if (offset >= total) return 0;
        uint256 n = total - offset;
        return n < limit ? n : limit;
    }

    function _popIndex(
        address[] storage arr,
        mapping(address => uint256) storage index,
        address who
    ) private {
        uint256 pos = index[who] - 1;
        address last = arr[arr.length - 1];
        arr[pos] = last;
        index[last] = pos + 1;
        arr.pop();
        delete index[who];
    }
}
