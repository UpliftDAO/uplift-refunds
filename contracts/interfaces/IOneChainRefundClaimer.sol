// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

/**
 * @title Interface for one-chain claiming refunds
 * @notice Adds additional functions which should be implemented for one-chaim refund claim
 */
interface IOneChainRefundClaimer {
    /**
     * @notice Set refund requester address (OneChainRefundRequester contract)
     * @param IDOToken_ - distribution token (which user bought in the IDO)
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param refundRequester_ - new refund requester address (OneChainRefundRequester contract)
     */
    function setRefundRequester(
        address IDOToken_,
        address identifier_,
        address refundRequester_
    ) external;

    /**
     * @notice Info for one-chain claim
     * @param IDOToken_ - distribution token (which user bought in the IDO)
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @return refundRequester - refund requester address (OneChainRefundRequester contract)
     */
    function refundRequesterOf(address IDOToken_, address identifier_) external view returns (address);

    /**
     * @dev Emitted when new refund requester is set
     */
    event SetRefundRequester(address indexed token, address indexed identifier, address indexed refundRequester);
}
