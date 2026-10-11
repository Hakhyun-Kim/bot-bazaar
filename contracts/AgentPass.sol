// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// BOT Bazaar agent pass — "trade with a named party, not an anonymous wallet".
///
/// On an AI-native chain many writes are signed by hot wallets: an autonomous agent, a bot, or a
/// small agent key in a game or app. Reputation and verification belong to the *principal* (the
/// human's or company's main wallet). The pass links the two: the principal signs a gasless
/// EIP-712 permission ("this agent acts for me"), and the agent submits it with link(). Both sides
/// must agree — the principal's signature and the agent's msg.sender.
///
/// This contract does not judge names or reputation. Clients read principalOf(agent) and show the
/// principal's profile. If an agent key is lost or compromised, the principal calls revoke().
contract AgentPass {
    /// agent -> the principal that appointed it (0 if none)
    mapping(address => address) public principalOf;
    /// per-principal nonce: each signature works once
    mapping(address => uint256) public nonces;

    bytes32 public constant LINK_TYPEHASH =
        keccak256("Link(address agent,address principal,uint256 nonce,uint256 deadline)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    /// secp256k1 n/2 — high-s signatures are rejected (malleability)
    uint256 private constant HALF_N =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    event Linked(address indexed agent, address indexed principal);
    event Unlinked(address indexed agent, address indexed principal);

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("BotBazaarAgentPass"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// Digest the principal signs — clients and tests read it to cross-check
    function linkDigest(address agent, address principal, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                keccak256(abi.encode(LINK_TYPEHASH, agent, principal, nonce, deadline))
            )
        );
    }

    /// The agent (msg.sender) links itself using the principal's signed permission.
    /// An existing link is replaced (the agent itself asked for it).
    function link(address principal, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        require(principal != address(0) && principal != msg.sender, "bad principal");
        require(block.timestamp <= deadline, "expired");
        require(uint256(s) <= HALF_N, "bad sig");
        bytes32 digest = linkDigest(msg.sender, principal, nonces[principal], deadline);
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == principal, "bad sig");
        nonces[principal]++;
        address prev = principalOf[msg.sender];
        if (prev != address(0)) emit Unlinked(msg.sender, prev);
        principalOf[msg.sender] = principal;
        emit Linked(msg.sender, principal);
    }

    /// The agent drops its own pass
    function unlink() external {
        address p = principalOf[msg.sender];
        require(p != address(0), "not linked");
        delete principalOf[msg.sender];
        emit Unlinked(msg.sender, p);
    }

    /// The principal revokes a pass (agent key lost or compromised)
    function revoke(address agent) external {
        require(principalOf[agent] == msg.sender, "not yours");
        delete principalOf[agent];
        emit Unlinked(agent, msg.sender);
    }

    /// Who to show: the principal if linked, otherwise the address itself
    function identityOf(address who) external view returns (address) {
        address p = principalOf[who];
        return p == address(0) ? who : p;
    }
}
