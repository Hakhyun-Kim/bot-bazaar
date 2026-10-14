// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBazaarMarket {
    function purchaseFor(address buyer, address payable seller, string calldata itemId)
        external
        payable
        returns (uint256 purchaseId);
}

/// BOT Bazaar offers — the buyer names a price and locks it in escrow; if the seller accepts, it
/// becomes a normal BazaarMarket purchase (24 h escrow, dispute, refund — nothing is settled
/// instantly). Offers below the listed price are allowed. Offers expire after 7 days; then anyone
/// may cancel, and the money always goes back to the buyer.
contract BazaarOffers {
    IBazaarMarket public immutable market;

    struct Offer {
        address buyer;
        address payable seller;
        uint128 amount;
        uint64 expiresAt;
        bool active;
        string itemName;
    }

    Offer[] private _offers;
    mapping(address => uint256[]) private _activeOf; // active offers per seller — swap-and-pop on close
    mapping(uint256 => uint256) private _activeIndex; // offer id -> position + 1

    uint64 public constant OFFER_TTL = 7 days;

    event OfferMade(
        uint256 indexed id,
        address indexed seller,
        address indexed buyer,
        string itemName,
        uint256 amount
    );
    event OfferCancelled(uint256 indexed id);
    event OfferAccepted(uint256 indexed id, uint256 purchaseId);

    /// Most BOT one offer may lock, in wei; 0 = no cap. Same value as the market's cap.
    uint128 public immutable maxAmount;

    constructor(address market_, uint128 maxAmount_) {
        market = IBazaarMarket(market_);
        maxAmount = maxAmount_;
    }

    function makeOffer(address payable seller, string calldata itemName)
        external
        payable
        returns (uint256 id)
    {
        require(seller != address(0) && seller != msg.sender, "seller");
        require(msg.value > 0 && msg.value <= type(uint128).max, "value");
        require(maxAmount == 0 || msg.value <= maxAmount, "cap");
        require(bytes(itemName).length >= 1 && bytes(itemName).length <= 48, "name");
        id = _offers.length;
        _offers.push(
            Offer(msg.sender, seller, uint128(msg.value), uint64(block.timestamp) + OFFER_TTL, true, itemName)
        );
        _activeOf[seller].push(id);
        _activeIndex[id] = _activeOf[seller].length;
        emit OfferMade(id, seller, msg.sender, itemName, msg.value);
    }

    /// The buyer at any time, or anyone after expiry — the locked money returns to the buyer
    function cancelOffer(uint256 id) external {
        Offer storage o = _offers[id];
        require(o.active, "inactive");
        require(msg.sender == o.buyer || block.timestamp > o.expiresAt, "buyer");
        _close(id, o);
        (bool ok, ) = payable(o.buyer).call{value: o.amount}("");
        require(ok, "refund");
        emit OfferCancelled(id);
    }

    /// Seller accepts — becomes an escrowed market purchase at the offered price
    function acceptOffer(uint256 id) external returns (uint256 purchaseId) {
        Offer storage o = _offers[id];
        require(o.active && msg.sender == o.seller, "seller");
        require(block.timestamp <= o.expiresAt, "expired");
        _close(id, o);
        purchaseId = market.purchaseFor{value: o.amount}(o.buyer, o.seller, o.itemName);
        emit OfferAccepted(id, purchaseId);
    }

    function _close(uint256 id, Offer storage o) private {
        o.active = false;
        uint256[] storage ids = _activeOf[o.seller];
        uint256 pos = _activeIndex[id] - 1;
        uint256 last = ids[ids.length - 1];
        ids[pos] = last;
        _activeIndex[last] = pos + 1;
        ids.pop();
        delete _activeIndex[id];
    }

    function offerAt(uint256 id) external view returns (Offer memory) {
        return _offers[id];
    }

    function offerCount() external view returns (uint256) {
        return _offers.length;
    }

    /// Active offers for a seller from offset, at most limit (expired ones stay until cancelled — check expiresAt)
    function offersFor(address seller, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Offer[] memory offers, uint256 total)
    {
        uint256[] storage all = _activeOf[seller];
        total = all.length;
        uint256 n = offset >= total ? 0 : total - offset;
        if (n > limit) n = limit;
        ids = new uint256[](n);
        offers = new Offer[](n);
        for (uint256 i; i < n; i++) {
            ids[i] = all[offset + i];
            offers[i] = _offers[ids[i]];
        }
    }
}
