// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentPassKind {
    function kindOf(address who) external view returns (uint8);
}

/// Bot or Not — a guessing game played on top of the market. No money, no prizes, only a score.
///
/// A trader who has not declared what they are (AgentPass.kindOf == 0) can enter a round by
/// committing to hash(self, isBot, salt). Anyone else can then guess "bot" or "human" once.
/// After at least a day the trader reveals; correct guessers claim a point, and the trader scores
/// one "fooled" for every wrong guess. Both leaderboards are on chain: the best detectives and the
/// most convincing traders — bots that pass as people and people that pass as bots.
///
/// The reveal is an honour system: the chain cannot see who is typing. A false reveal is visible
/// forever next to the trader's address, and a trader linked to a principal through AgentPass
/// stakes that principal's name on it. A trader who never reveals within 14 days can be marked
/// as forfeited by anyone.
contract BotOrNot {
    IAgentPassKind public immutable pass;

    uint64 public constant MIN_ROUND = 1 days;
    uint64 public constant MAX_ROUND = 14 days;
    uint8 private constant VOTE_HUMAN = 1;
    uint8 private constant VOTE_BOT = 2;
    uint8 private constant CLAIMED = 3;

    struct Round {
        bytes32 commitment;
        uint64 startedAt;
        uint32 humanVotes;
        uint32 botVotes;
        bool closed;
        bool revealed;
        bool wasBot;
    }

    struct Score {
        uint32 guesses;
        uint32 correct;
        uint32 rounds; // rounds revealed as a trader
        uint32 fooled; // wrong guesses made about this trader
        uint32 forfeits;
    }

    mapping(address => Round[]) private _rounds;
    mapping(address => mapping(uint256 => mapping(address => uint8))) private _vote;
    mapping(address => Score) public scoreOf;
    address[] private _players;
    mapping(address => bool) private _seen;

    event Entered(address indexed trader, uint256 round);
    event Guessed(address indexed trader, uint256 round, address indexed guesser, bool bot);
    event Revealed(address indexed trader, uint256 round, bool wasBot, uint32 fooled);
    event Forfeited(address indexed trader, uint256 round);
    event PointClaimed(address indexed guesser, address indexed trader, uint256 round);

    constructor(address pass_) {
        pass = IAgentPassKind(pass_);
    }

    /// Helper for clients: the commitment to pass to enter()
    function commitmentOf(address trader, bool isBot, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(trader, isBot, salt));
    }

    function enter(bytes32 commitment) external returns (uint256 round) {
        require(pass.kindOf(msg.sender) == 0, "declared");
        Round[] storage rs = _rounds[msg.sender];
        require(rs.length == 0 || rs[rs.length - 1].closed, "open");
        rs.push(Round(commitment, uint64(block.timestamp), 0, 0, false, false, false));
        round = rs.length - 1;
        _join(msg.sender);
        emit Entered(msg.sender, round);
    }

    function guess(address trader, bool bot) external {
        require(trader != msg.sender, "self");
        require(pass.kindOf(trader) == 0, "declared"); // declaring mid-round ends the guessing
        Round[] storage rs = _rounds[trader];
        require(rs.length > 0, "none");
        uint256 round = rs.length - 1;
        Round storage r = rs[round];
        require(!r.closed, "closed");
        require(_vote[trader][round][msg.sender] == 0, "voted");
        _vote[trader][round][msg.sender] = bot ? VOTE_BOT : VOTE_HUMAN;
        if (bot) r.botVotes++;
        else r.humanVotes++;
        scoreOf[msg.sender].guesses++;
        _join(msg.sender);
        emit Guessed(trader, round, msg.sender, bot);
    }

    function reveal(bool wasBot, bytes32 salt) external {
        Round[] storage rs = _rounds[msg.sender];
        require(rs.length > 0, "none");
        uint256 round = rs.length - 1;
        Round storage r = rs[round];
        require(!r.closed, "closed");
        require(block.timestamp >= r.startedAt + MIN_ROUND, "early");
        require(commitmentOf(msg.sender, wasBot, salt) == r.commitment, "commitment");
        r.closed = true;
        r.revealed = true;
        r.wasBot = wasBot;
        uint32 fooled = wasBot ? r.humanVotes : r.botVotes;
        Score storage s = scoreOf[msg.sender];
        s.rounds++;
        s.fooled += fooled;
        emit Revealed(msg.sender, round, wasBot, fooled);
    }

    /// Anyone may close a round that was not revealed within 14 days. Nobody scores from it.
    function forfeit(address trader) external {
        Round[] storage rs = _rounds[trader];
        require(rs.length > 0, "none");
        Round storage r = rs[rs.length - 1];
        require(!r.closed, "closed");
        require(block.timestamp > r.startedAt + MAX_ROUND, "early");
        r.closed = true;
        scoreOf[trader].forfeits++;
        emit Forfeited(trader, rs.length - 1);
    }

    /// A correct guesser claims their point after the reveal (no loop over voters at reveal time)
    function claim(address trader, uint256 round) external {
        Round storage r = _rounds[trader][round];
        require(r.revealed, "unrevealed");
        uint8 v = _vote[trader][round][msg.sender];
        require(v == VOTE_HUMAN || v == VOTE_BOT, "no vote");
        require((v == VOTE_BOT) == r.wasBot, "wrong");
        _vote[trader][round][msg.sender] = CLAIMED;
        scoreOf[msg.sender].correct++;
        emit PointClaimed(msg.sender, trader, round);
    }

    function roundCount(address trader) external view returns (uint256) {
        return _rounds[trader].length;
    }

    function roundOf(address trader, uint256 round) external view returns (Round memory) {
        return _rounds[trader][round];
    }

    function voteOf(address trader, uint256 round, address guesser) external view returns (uint8) {
        return _vote[trader][round][guesser];
    }

    function playerCount() external view returns (uint256) {
        return _players.length;
    }

    /// Players with scores from offset, at most limit — frontends sort for the leaderboards
    function players(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory who, Score[] memory scores)
    {
        uint256 total = _players.length;
        uint256 n = offset >= total ? 0 : total - offset;
        if (n > limit) n = limit;
        who = new address[](n);
        scores = new Score[](n);
        for (uint256 i; i < n; i++) {
            who[i] = _players[offset + i];
            scores[i] = scoreOf[who[i]];
        }
    }

    function _join(address who) private {
        if (_seen[who]) return;
        _seen[who] = true;
        _players.push(who);
    }
}
