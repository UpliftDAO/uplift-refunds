// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

interface IOneChainRefundClaimer {
    function setRefundRequester(
        address token_,
        address identifier_,
        address refundRequester_
    ) external;

    // [token][identifier]
    function refundRequesterOf(address token_, address identifier_) external view returns (address);

    event SetRefundRequester(address indexed token, address indexed identifier, address indexed refundRequester);
}
