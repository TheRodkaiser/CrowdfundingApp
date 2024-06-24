const { Gateway, Wallets } = require('fabric-network');
const fs = require('fs');
const path = require("path");
const log4js = require('log4js');
const logger = log4js.getLogger('BasicNetwork');
const util = require('util');

const helper = require('./helper');
const { blockListener, contractListener } = require('./Listeners');

const invokeTransaction = async (channelName, chaincodeName, fcn, args, username, org_name, transientData) => {
    try {
        const ccp = await helper.getCCP(org_name);

        const walletPath = await helper.getWalletPath(org_name);
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        logger.debug(`Wallet path: ${walletPath}`);
        
        let identity = await wallet.get(username);
        if (!identity) {
            logger.debug(`An identity for the user ${username} does not exist in the wallet, need to register the user`);
            await helper.getRegisteredUser(username, org_name, true);
            identity = await wallet.get(username);
            if (!identity) {
                logger.error('Failed to register user and retrieve identity from wallet.');
                return;
            }
        }

        const connectOptions = {
            wallet, 
            identity: username, 
            discovery: { enabled: true, asLocalhost: true }
        };

        const gateway = new Gateway();
        await gateway.connect(ccp, connectOptions);

        const network = await gateway.getNetwork(channelName);
        const contract = network.getContract(chaincodeName);

        let result;
        switch (fcn) {
            case 'CreateProject':
            case 'Contribute':
            case 'DistributeRewards':
            case 'RegisterUser':
                result = await contract.submitTransaction(fcn, ...args);
                result = {txid: result.toString()};
                break;
            default:
                throw new Error(`Function ${fcn} not found`);
        }

        await gateway.disconnect();

        let response = {
            message: 'Transaction has been submitted',
            result
        };

        return response;
    } catch (error) {
        logger.error(`Failed to submit transaction: ${error}`);
        return { success: false, message: error.message };
    }
}

exports.invokeTransaction = invokeTransaction;
