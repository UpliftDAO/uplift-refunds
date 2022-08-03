// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

/**
 * @title Base interface for claiming refunds
 * @notice Base interface implements function for both one- and multi- chain refund claimers
 */
interface IBaseRefundClaimer {
    /**
     * @notice Data needed for claim
     * @param token - buy token, can't be zero address
     * @param identifier - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param data - custom data, which can be different for different types (one- and multi- chain)
     */
    struct ClaimRefundData {
        address token;
        address identifier;
        bytes data;
    }

    /**
     * @notice Claim refund function
     * @param claimRefundData_ - parameters which needed to be passed to claim refund
     */
    function claimRefund(ClaimRefundData[] calldata claimRefundData_) external;

    /**
     * @notice Claim refund function (for another account)
     * @param account_ - account, for which we should claim funds
     * @param claimRefundData_ - parameters which needed to be passed to claim refund
     */
    function claimRefundForAccount(address account_, ClaimRefundData[] calldata claimRefundData_) external;

    /**
     * @notice Amount of already claimed buy tokens (for account)
     * @param token_ - buy token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param account_ - user's address
     * @return amount - claimed amount
     */
    function refundClaimedInBuyToken(
        address token_,
        address identifier_,
        address account_
    ) external view returns (uint256);

    /**
     * @dev Emitted when user claimed refunds
     */
    event ClaimRefund(
        address caller,
        address indexed token,
        address indexed identifier,
        address indexed account,
        uint256 amount
    );
}
