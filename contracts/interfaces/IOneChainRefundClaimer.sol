// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

/**
 * @title Interface for one-chain claiming refunds
 * @notice Adds additional functions which should be implemented for one-chaim refund claim
 */
interface IOneChainRefundClaimer {
    /**
     * @notice Data needed for refund requester identification
     * @param refundRequester - refund requester address (OneChainRefundRequester contract)
     * @param IDOToken - IDO token, which unique identifies this refund in OneChainRefundRequester contract
     */
    struct OneChainRefundInfo {
        address refundRequester;
        address IDOToken;
    }

    /**
     * @notice Set refund requester address (OneChainRefundRequester contract)
     * @param token_ - buy token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param refundRequester_ - new refund requester address (OneChainRefundRequester contract)
     */
    function setRefundRequester(
        address token_,
        address identifier_,
        address refundRequester_
    ) external;

    /**
     * @notice Set IDO token address
     * @param token_ - buy token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param IDOToken_ - new IDO token address
     */
    function setIDOToken(
        address token_,
        address identifier_,
        address IDOToken_
    ) external;

    /**
     * @notice Info for one-chain claim
     * @param token_ - buy token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @return refundRequester - refund requester address (OneChainRefundRequester contract)
     * @return IDOToken - IDO token, which unique identifies this refund in OneChainRefundRequester contract
     */
    function requesterInfoOf(address token_, address identifier_) external view returns (address, address);

    /**
     * @dev Emitted when new refund requester is set
     */
    event SetRefundRequester(address indexed token, address indexed identifier, address indexed refundRequester);
    /**
     * @dev Emitted when new IDO token is set
     */
    event SetIDOToken(address indexed token, address indexed identifier, address indexed IDOToken);
}
