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
     * @param KPIIndices - array of KPI indices, which will be claimed
     */
    struct ClaimRefundData {
        address token;
        address identifier;
        bytes data;
        uint8[] KPIIndices;
    }

    /**
     * @notice Info struct
     * @param KPIIndex - index of corresponding KPI
     * @param refundClaimedByKPIInIDOToken - claimed refund (in IDO token)
     */
    struct RefundClaimedInfoOfData {
        uint8 KPIIndex;
        uint256 refundClaimedByKPIInIDOToken;
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
     * @notice Amounts of already claimed in IDO tokens (for account)
     * @param token_ - buy token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param account_ - user's address
     * @param KPIIndices_ - array of KPI indices
     * @return amount - claimed amount in buy token
     */
    function infoOf(
        address token_,
        address identifier_,
        address account_,
        uint8[] calldata KPIIndices_
    ) external view returns (RefundClaimedInfoOfData[] memory);

    /**
     * @dev Emitted when user claimed refunds
     */
    event ClaimRefund(
        address caller,
        address indexed token,
        address indexed identifier,
        address indexed account,
        uint256 amount,
        uint256 receivedAmount
    );
}
