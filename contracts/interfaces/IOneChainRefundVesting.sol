// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

interface IOneChainRefundVesting {
    function IDOOf(address) external view returns (address);

    event SetIDO(address indexed token, address indexed IDO);
}
