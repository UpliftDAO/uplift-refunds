// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

interface IBaseRefundClaimer {
    struct ClaimRefundData {
        address token;
        address identifier;
        bytes data;
    }

    function claimRefund(ClaimRefundData[] calldata claimRefundData_) external;

    function claimRefundForAccount(address account_, ClaimRefundData[] calldata claimRefundData_) external;

    // [token][identifier][account]
    function refundClaimedInBuyToken(
        address token_,
        address identifier_,
        address account_
    ) external view returns (uint256);

    event ClaimRefund(
        address caller,
        address indexed token,
        address indexed identifier,
        address indexed account,
        uint256 amount
    );
}
