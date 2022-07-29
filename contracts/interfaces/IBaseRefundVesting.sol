// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

interface IBaseRefundVesting {
    struct InitializeInfo {
        address token;
        address refund;
        // Added because we can have 2+ distributions for 1 token (for different data providers)
        address identifier;
    }

    struct ReturnInfo {
        address refund;
        uint256 total;
        uint256 totalClaimed;
        uint256 withdrawableAmount;
    }

    // [token][identifier]
    function refundOf(address, address) external view returns (address);

    // [token][identifier][account]
    function claimed(
        address,
        address,
        address
    ) external view returns (uint256);

    function addTokenInfo(InitializeInfo calldata initializeInfo_, bytes calldata data_) external;

    function setRefund(
        address token_,
        address identifier_,
        address refund_
    ) external;

    function withdraw(address token_, address identifier_) external;

    function withdrawableOf(
        address token_,
        address identifier_,
        address account_
    ) external view returns (uint256);

    event SetRefund(address indexed token, address indexed identifier, address indexed refund);
    event Withdraw(address indexed token, address indexed identifier, address indexed account, uint256 amount);
}
