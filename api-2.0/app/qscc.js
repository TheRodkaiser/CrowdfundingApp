const { Gateway, Wallets, BlockDecoder } = require('fabric-network');
const log4js = require('log4js');
const logger = log4js.getLogger('BasicNetwork');
const util = require('util');
const helper = require('./helper');

const qscc = async (channelName, chaincodeName, args, fcn, username, org_name) => {
    try {
        const ccp = await helper.getCCP(org_name);

        const walletPath = await helper.getWalletPath(org_name);
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        logger.debug(`Wallet path: ${walletPath}`);

        let identity = await wallet.get(username);
        if (!identity) {
            logger.debug(`An identity for the user ${username} does not exist in the wallet, so registering user`);
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
            case 'GetBlockByNumber':
                result = await contract.evaluateTransaction(fcn, channelName, args[0]);
                result = BlockDecoder.decode(result);
                break;
            case 'GetTransactionByID':
                result = await contract.evaluateTransaction(fcn, channelName, args[0]);
                result = BlockDecoder.decodeTransaction(result);
                break;
            default:
                throw new Error(`Function ${fcn} not found`);
        }

        await gateway.disconnect();

        return result;
    } catch (error) {
        logger.error(`Failed to evaluate transaction: ${error}`);
        return { success: false, message: error.message };
    }
}

exports.qscc = qscc;
