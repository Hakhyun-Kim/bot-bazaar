// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// BOT Bazaar gas tank — sponsored free play.
///
/// A sponsor (a grant, the team) fills the tank with BOT. A new player's browser wallet starts
/// empty, so it cannot pay for its own first transaction; the sponsor's relayer asks the tank to
/// send that wallet a small, fixed amount of gas money once. Everything is bounded on-chain, so a
/// leaked relayer key or a swarm of fresh wallets can cost at most one day's cap:
///   - one drip per address, of a fixed size, only to an address without code holding less than it;
///   - a daily cap across all drips;
///   - the owner (the sponsor's own wallet) can pause by changing the relayer, or take the rest back.
/// This is the sponsor's tank, not one of the shared market contracts: no trade goes through it.
/// The counters are public so anyone can see how many players a grant brought in and what it cost.
contract GasTank {
    address public immutable owner;
    uint256 public immutable dripAmount;
    uint256 public immutable dailyCap;
    address public relayer;

    uint64 public day; // block.timestamp / 1 days of the last drip (packed with spentToday: one slot)
    uint192 public spentToday;
    uint256 public dripCount;
    uint256 public totalFunded;
    mapping(address => bool) public dripped;

    event Funded(address indexed from, uint256 amount);
    event Dripped(address indexed to, uint256 amount);
    event RelayerSet(address relayer);
    event Withdrawn(address indexed to, uint256 amount);

    constructor(address owner_, address relayer_, uint256 dripAmount_, uint256 dailyCap_) {
        require(owner_ != address(0) && dripAmount_ > 0 && dailyCap_ >= dripAmount_, "config");
        owner = owner_;
        relayer = relayer_;
        dripAmount = dripAmount_;
        dailyCap = dailyCap_;
        emit RelayerSet(relayer_);
    }

    function totalDripped() external view returns (uint256) {
        return dripCount * dripAmount;
    }

    receive() external payable {
        totalFunded += msg.value;
        emit Funded(msg.sender, msg.value);
    }

    /// Why `to` cannot get a drip right now ("" = it can). The relayer checks this before paying gas.
    function refusal(address to) public view returns (string memory) {
        if (dripped[to]) return "already";
        if (to.code.length != 0) return "contract";
        if (to.balance >= dripAmount) return "has-gas";
        uint256 spent = block.timestamp / 1 days == day ? spentToday : 0;
        if (spent + dripAmount > dailyCap) return "daily-cap";
        if (address(this).balance < dripAmount) return "empty";
        return "";
    }

    function drip(address payable to) external {
        require(msg.sender == relayer, "relayer");
        string memory why = refusal(to);
        require(bytes(why).length == 0, why);
        uint64 today = uint64(block.timestamp / 1 days);
        if (today != day) (day, spentToday) = (today, 0);
        spentToday += uint192(dripAmount);
        dripped[to] = true;
        dripCount += 1;
        (bool ok, ) = to.call{value: dripAmount}("");
        require(ok, "send");
        emit Dripped(to, dripAmount);
    }

    /// address(0) pauses the tank.
    function setRelayer(address relayer_) external {
        require(msg.sender == owner, "owner");
        relayer = relayer_;
        emit RelayerSet(relayer_);
    }

    function withdraw(uint256 amount) external {
        require(msg.sender == owner, "owner");
        (bool ok, ) = payable(owner).call{value: amount}("");
        require(ok, "send");
        emit Withdrawn(owner, amount);
    }
}
