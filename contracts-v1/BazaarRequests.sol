// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// BOT Bazaar requests — the wanted board, the market in reverse. Anyone posts a task with the
/// reward locked in escrow; anyone else pitches; the poster assigns one worker; the worker submits
/// a result; the poster accepts, or the reward releases to the worker after a review window.
///
/// Humans hire bots, bots hire humans, bots hire bots. The contract never asks which is which:
/// `wants` is only a label the poster shows ("bots welcome", "humans only please"), and the
/// same escrow rules protect every side.
///
/// Escrow rules, mirroring BazaarMarket:
/// - Before anyone is assigned, the poster can cancel and take the reward back.
/// - An assigned worker who misses the deadline lets the poster reclaim the reward.
/// - After submission the poster has 3 days to accept or dispute. A dispute extends that to 10
///   days; the worker can hand the reward back at any time. After the window anyone may release
///   the reward to the worker, so a silent poster cannot keep work for free.
/// No fee, no admin key.
contract BazaarRequests {
    /// Version 1.0: fixes L-1 to L-4 and L-6 of docs/audit/internal-review.md (see docs/audit/v1.md)
    string public constant VERSION = "1.0";
    uint8 public constant WANTS_ANYONE = 0;
    uint8 public constant WANTS_HUMANS = 1;
    uint8 public constant WANTS_BOTS = 2;

    uint8 public constant OPEN = 0;
    uint8 public constant ASSIGNED = 1;
    uint8 public constant SUBMITTED = 2;
    uint8 public constant PAID = 3;
    uint8 public constant RETURNED = 4; // reward back with the poster

    uint64 public constant REVIEW = 3 days;
    uint64 public constant DISPUTE_REVIEW = 10 days;

    struct Request {
        address payable poster;
        address payable worker;
        uint128 reward;
        uint64 deadline; // submission deadline once assigned
        uint64 releaseAt; // set on submission
        uint8 wants;
        uint8 state;
        bool disputed;
        string title;
        string detailsURI;
        string resultURI;
    }

    /// Most BOT one reward may lock, in wei; 0 = no cap. Set once at deployment.
    uint128 public immutable maxAmount;

    constructor(uint128 maxAmount_) {
        maxAmount = maxAmount_;
    }

    Request[] private _requests;
    uint256[] private _open; // OPEN requests only — swap-and-pop
    mapping(uint256 => uint256) private _openIndex; // id -> position + 1

    event Posted(uint256 indexed id, address indexed poster, uint8 wants, uint256 reward, string title);
    event Pitched(uint256 indexed id, address indexed worker, string note);
    event Assigned(uint256 indexed id, address indexed worker);
    event Submitted(uint256 indexed id, address indexed worker, string resultURI);
    event Disputed(uint256 indexed id);
    event Paid(uint256 indexed id, address indexed worker, uint256 reward);
    event Returned(uint256 indexed id, address indexed poster, uint256 reward);

    function post(
        string calldata title,
        string calldata detailsURI,
        uint8 wants,
        uint64 deadline
    ) external payable returns (uint256 id) {
        require(msg.value > 0 && msg.value <= type(uint128).max, "reward");
        require(maxAmount == 0 || msg.value <= maxAmount, "cap");
        require(bytes(title).length >= 1 && bytes(title).length <= 80, "title");
        require(bytes(detailsURI).length <= 200, "uri");
        require(wants <= WANTS_BOTS, "wants");
        require(deadline > block.timestamp, "deadline");
        id = _requests.length;
        _requests.push(
            Request(payable(msg.sender), payable(address(0)), uint128(msg.value), deadline, 0, wants, OPEN, false, title, detailsURI, "")
        );
        _open.push(id);
        _openIndex[id] = _open.length;
        emit Posted(id, msg.sender, wants, msg.value, title);
    }

    /// Offer to do it — an event only; the poster reads pitches and picks one
    function pitch(uint256 id, string calldata note) external {
        Request storage r = _requests[id];
        require(r.state == OPEN, "state");
        require(msg.sender != r.poster, "self");
        require(bytes(note).length <= 200, "note");
        emit Pitched(id, msg.sender, note);
    }

    function assign(uint256 id, address payable worker) external {
        Request storage r = _requests[id];
        require(msg.sender == r.poster, "poster");
        require(r.state == OPEN, "state");
        require(worker != address(0) && worker != r.poster, "worker");
        require(block.timestamp < r.deadline, "deadline");
        r.worker = worker;
        r.state = ASSIGNED;
        _closeOpen(id);
        emit Assigned(id, worker);
    }

    function cancel(uint256 id) external {
        Request storage r = _requests[id];
        require(msg.sender == r.poster, "poster");
        require(r.state == OPEN, "state");
        _closeOpen(id);
        _return(id, r);
    }

    function submit(uint256 id, string calldata resultURI) external {
        Request storage r = _requests[id];
        require(msg.sender == r.worker, "worker");
        require(r.state == ASSIGNED, "state");
        require(block.timestamp <= r.deadline, "late");
        require(bytes(resultURI).length >= 1 && bytes(resultURI).length <= 200, "uri");
        r.resultURI = resultURI;
        r.state = SUBMITTED;
        r.releaseAt = uint64(block.timestamp) + REVIEW;
        emit Submitted(id, msg.sender, resultURI);
    }

    /// Assigned worker missed the deadline — the poster takes the reward back
    function reclaim(uint256 id) external {
        Request storage r = _requests[id];
        require(msg.sender == r.poster, "poster");
        require(r.state == ASSIGNED && block.timestamp > r.deadline, "state");
        _return(id, r);
    }

    function accept(uint256 id) external {
        Request storage r = _requests[id];
        require(msg.sender == r.poster, "poster");
        require(r.state == SUBMITTED, "state");
        _pay(id, r);
    }

    function dispute(uint256 id) external {
        Request storage r = _requests[id];
        require(msg.sender == r.poster, "poster");
        require(r.state == SUBMITTED && !r.disputed, "state");
        require(block.timestamp < r.releaseAt, "late");
        r.disputed = true;
        r.releaseAt = uint64(block.timestamp) + DISPUTE_REVIEW;
        emit Disputed(id);
    }

    /// The worker hands the reward back (after a dispute, or by choice)
    function handBack(uint256 id) external {
        Request storage r = _requests[id];
        require(msg.sender == r.worker, "worker");
        require(r.state == ASSIGNED || r.state == SUBMITTED, "state");
        _return(id, r);
    }

    /// After the review window anyone may pay the worker
    function release(uint256 id) external {
        Request storage r = _requests[id];
        require(r.state == SUBMITTED && block.timestamp >= r.releaseAt, "state");
        _pay(id, r);
    }

    function requestAt(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    function requestCount() external view returns (uint256) {
        return _requests.length;
    }

    /// Open requests from offset, at most limit
    function openRequests(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Request[] memory list, uint256 total)
    {
        total = _open.length;
        uint256 n = offset >= total ? 0 : total - offset;
        if (n > limit) n = limit;
        ids = new uint256[](n);
        list = new Request[](n);
        for (uint256 i; i < n; i++) {
            ids[i] = _open[offset + i];
            list[i] = _requests[ids[i]];
        }
    }

    function _pay(uint256 id, Request storage r) private {
        r.state = PAID;
        _send(r.worker, r.reward);
        emit Paid(id, r.worker, r.reward);
    }

    function _return(uint256 id, Request storage r) private {
        r.state = RETURNED;
        _send(r.poster, r.reward);
        emit Returned(id, r.poster, r.reward);
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

    function _closeOpen(uint256 id) private {
        uint256 pos = _openIndex[id] - 1;
        uint256 last = _open[_open.length - 1];
        _open[pos] = last;
        _openIndex[last] = pos + 1;
        _open.pop();
        delete _openIndex[id];
    }
}
