// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
  function transfer(address to, uint256 amount) external returns (bool);
}

contract SessionVault {
  IERC20 public immutable PYUSD;

  struct Session {
    address user;
    address merchant;
    uint256 allowance;     // max spend approved by user for this session
    uint256 spent;         // amount accounted by off-chain session (Yellow)
    bool settled;
  }

  mapping(bytes32 => Session) public sessions; // sessionId -> Session
  mapping(address => uint256) public deposits; // user -> PYUSD balance held

  event Deposited(address indexed user, uint256 amount);
  event SessionOpened(bytes32 indexed id, address indexed user, address indexed merchant, uint256 allowance);
  event OffchainSpendAccounted(bytes32 indexed id, uint256 newTotalSpent);
  event Settled(bytes32 indexed id, uint256 paidToMerchant, uint256 refundToUser);

  constructor(address _pyusd) {
    PYUSD = IERC20(_pyusd);
  }

  // User pre-funds vault
  function deposit(uint256 amount) external {
    require(PYUSD.transferFrom(msg.sender, address(this), amount));
    deposits[msg.sender] += amount;
    emit Deposited(msg.sender, amount);
  }

  // App/back-end creates session after user signs a permit/approval in UI
  function openSession(bytes32 id, address user, address merchant, uint256 allowance) external {
    require(sessions[id].user == address(0), "exists");
    require(deposits[user] >= allowance, "insufficient deposit");
    sessions[id] = Session(user, merchant, allowance, 0, false);
    emit SessionOpened(id, user, merchant, allowance);
  }

  // Called by your back-end after off-chain increments via Yellow
  function accountOffchainSpend(bytes32 id, uint256 newTotalSpent) external {
    Session storage s = sessions[id];
    require(s.user != address(0) && !s.settled, "bad session");
    require(newTotalSpent >= s.spent, "nondecreasing");
    require(newTotalSpent <= s.allowance, "over allowance");
    s.spent = newTotalSpent;
    emit OffchainSpendAccounted(id, s.spent);
  }

  // End & settle: pay merchant, refund remainder
  function settle(bytes32 id) external {
    Session storage s = sessions[id];
    require(!s.settled && s.user != address(0), "bad session");
    s.settled = true;

    // move funds from user's deposit
    deposits[s.user] -= s.spent;
    require(PYUSD.transfer(s.merchant, s.spent));

    emit Settled(id, s.spent, 0);
  }
}
