// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Minimal ERC20 interface
interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address a) external view returns (uint256);
}

contract SessionVault {
    IERC20 public immutable PYUSD; // PYUSD is 6 decimals on Sepolia

    struct Session {
        address user;
        address merchant;
        uint256 allowance; // amount reserved from user's deposit for this session (in PYUSD smallest units)
        uint256 spent;     // total off-chain accounted spend so far (monotonic, <= allowance)
        bool open;
    }

    // Simple user deposit bucket; you may switch to per-session escrow later
    mapping(address => uint256) public deposits;
    mapping(bytes32 => Session) public sessions;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event SessionOpened(bytes32 indexed id, address indexed user, address indexed merchant, uint256 allowance);
    event OffchainSpend(bytes32 indexed id, uint256 newTotalSpent);
    event Settled(bytes32 indexed id, address indexed user, address indexed merchant, uint256 paid, uint256 refund);

    constructor(address _pyusd) {
        require(_pyusd != address(0), "PYUSD=0");
        PYUSD = IERC20(_pyusd);
    }

    // --- Funds management ---

    /// @notice User must approve this contract to spend PYUSD before calling.
    function deposit(uint256 amount) external {
        require(amount > 0, "amount=0");
        require(PYUSD.transferFrom(msg.sender, address(this), amount), "transferFrom fail");
        deposits[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw unreserved funds (not allocated to any open session allowance).
    function withdraw(uint256 amount) external {
        require(amount > 0, "amount=0");
        require(deposits[msg.sender] >= amount, "insufficient");
        // NOTE: This simple model does not lock deposit per session; you must ensure
        // you don't over-withdraw beyond what's needed for active session allowances.
        // For hackathon scope, we'll rely on client/server discipline.
        deposits[msg.sender] -= amount;
        require(PYUSD.transfer(msg.sender, amount), "transfer fail");
        emit Withdrawn(msg.sender, amount);
    }

    // --- Session lifecycle ---

    /// @notice Reserve `allowance` from user's deposit bucket for this session (soft reservation).
    function openSession(bytes32 id, address user, address merchant, uint256 allowance) external {
        require(!sessions[id].open && sessions[id].user == address(0), "session exists");
        require(user != address(0) && merchant != address(0), "bad addr");
        require(allowance > 0, "allowance=0");
        require(deposits[user] >= allowance, "deposit<allowance");

        sessions[id] = Session({
            user: user,
            merchant: merchant,
            allowance: allowance,
            spent: 0,
            open: true
        });

        emit SessionOpened(id, user, merchant, allowance);
    }

    /// @notice Off-chain accounting: `newTotalSpent` must be >= previous and <= allowance.
    function accountOffchainSpend(bytes32 id, uint256 newTotalSpent) external {
        Session storage s = sessions[id];
        require(s.open, "closed");
        require(s.user != address(0), "no session");
        require(newTotalSpent >= s.spent, "non-monotonic");
        require(newTotalSpent <= s.allowance, "exceeds allowance");

        s.spent = newTotalSpent;
        emit OffchainSpend(id, newTotalSpent);
    }

    /// @notice Transfer `spent` to merchant and refund (allowance - spent) to user. Close session.
    function settle(bytes32 id) external {
        Session storage s = sessions[id];
        require(s.open, "closed");
        s.open = false;

        uint256 paid = s.spent;
        uint256 refund = s.allowance > s.spent ? (s.allowance - s.spent) : 0;

        // Consume allowance from user's deposit
        deposits[s.user] -= s.allowance;

        // Pay merchant
        if (paid > 0) {
            require(PYUSD.transfer(s.merchant, paid), "pay fail");
        }
        // Refund user
        if (refund > 0) {
            require(PYUSD.transfer(s.user, refund), "refund fail");
        }

        emit Settled(id, s.user, s.merchant, paid, refund);
    }
}
