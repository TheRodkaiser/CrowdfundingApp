'use strict';
const log4js = require('log4js');
const logger = log4js.getLogger('BasicNetwork');
const bodyParser = require('body-parser');
const http = require('http')
const util = require('util');
const express = require('express')
const app = express();
const expressJWT = require('express-jwt');
const jwt = require('jsonwebtoken');
const bearerToken = require('express-bearer-token');
const cors = require('cors');
const constants = require('./config/constants.json')
const crypto = require('crypto');


const host = process.env.HOST || constants.host;
const port = process.env.PORT || constants.port;


const helper = require('./app/helper')
const invoke = require('./app/invoke')
const qscc = require('./app/qscc')
const query = require('./app/query')

app.options('*', cors());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: false
}));
// set secret variable
app.set('secret', 'thisismysecret');
app.use(expressJWT({
    secret: 'thisismysecret'
}).unless({
    path: ['/users','/users/login', '/register']
}));
app.use(bearerToken());

logger.level = 'debug';


app.use((req, res, next) => {
    logger.debug('New req for %s', req.originalUrl);
    if (req.originalUrl.indexOf('/users') >= 0 || req.originalUrl.indexOf('/users/login') >= 0 || req.originalUrl.indexOf('/register') >= 0) {
        return next();
    }
    var token = req.token;
    jwt.verify(token, app.get('secret'), (err, decoded) => {
        if (err) {
            console.log(`Error ================:${err}`)
            res.send({
                success: false,
                message: 'Failed to authenticate token. Make sure to include the ' +
                    'token returned from /users call in the authorization header ' +
                    ' as a Bearer token'
            });
            return;
        } else {
            req.username = decoded.username;
            req.orgname = decoded.orgName;
            logger.debug(util.format('Decoded from JWT token: username - %s, orgname - %s', decoded.username, decoded.orgName));
            return next();
        }
    });
});

var server = http.createServer(app).listen(port, function () { console.log(`Server started on ${port}`) });
logger.info('****************** SERVER STARTED ************************');
logger.info('***************  http://%s:%s  ******************', host, port);
server.timeout = 240000;

function getErrorMessage(field) {
    var response = {
        success: false,
        message: field + ' field is missing or Invalid in the request'
    };
    return response;
}

// Register and enroll user
app.post('/users', async function (req, res) {
    var username = req.body.username;
    var orgName = req.body.orgName;
    logger.debug('End point : /users');
    logger.debug('User name : ' + username);
    logger.debug('Org name  : ' + orgName);
    if (!username) {
        res.json(getErrorMessage('\'username\''));
        return;
    }
    if (!orgName) {
        res.json(getErrorMessage('\'orgName\''));
        return;
    }

    var token = jwt.sign({
        exp: Math.floor(Date.now() / 1000) + parseInt(constants.jwt_expiretime),
        username: username,
        orgName: orgName
    }, app.get('secret'));

    let response = await helper.getRegisteredUser(username, orgName, true);

    logger.debug('-- returned from registering the username %s for organization %s', username, orgName);
    if (response && typeof response !== 'string') {
        logger.debug('Successfully registered the username %s for organization %s', username, orgName);
        response.token = token;
        res.json(response);
    } else {
        logger.debug('Failed to register the username %s for organization %s with::%s', username, orgName, response);
        res.json({ success: false, message: response });
    }

});

// Register and enroll user
app.post('/register', async function (req, res) {
    var username = req.body.username;
    var orgName = req.body.orgName;
    var orgName = req.body.password;
    logger.debug('End point : /users');
    logger.debug('User name : ' + username);
    logger.debug('Org name  : ' + orgName);
    if (!username) {
        res.json(getErrorMessage('\'username\''));
        return;
    }
    if (!orgName) {
        res.json(getErrorMessage('\'orgName\''));
        return;
    }

    var token = jwt.sign({
        exp: Math.floor(Date.now() / 1000) + parseInt(constants.jwt_expiretime),
        username: username,
        orgName: orgName
    }, app.get('secret'));

    console.log(token)

    let response = await helper.registerAndGetSecret(username, orgName, password);

    logger.debug('-- returned from registering the username %s for organization %s', username, orgName);
    if (response && typeof response !== 'string') {
        logger.debug('Successfully registered the username %s for organization %s', username, orgName);
        response.token = token;
        res.json(response);
    } else {
        logger.debug('Failed to register the username %s for organization %s with::%s', username, orgName, response);
        res.json({ success: false, message: response });
    }

});

// Login and get jwt
app.post('/users/login', async function (req, res) {
    var username = req.body.username;
    var orgName = req.body.orgName;
    logger.debug('End point : /users');
    logger.debug('User name : ' + username);
    logger.debug('Org name  : ' + orgName);
    if (!username) {
        res.json(getErrorMessage('\'username\''));
        return;
    }
    if (!orgName) {
        res.json(getErrorMessage('\'orgName\''));
        return;
    }

    var token = jwt.sign({
        exp: Math.floor(Date.now() / 1000) + parseInt(constants.jwt_expiretime),
        username: username,
        orgName: orgName
    }, app.get('secret'));

    let isUserRegistered = await helper.isUserRegistered(username, orgName);

    if (isUserRegistered) {
        res.json({ success: true, message: { token: token } });

    } else {
        res.json({ success: false, message: `User with username ${username} is not registered with ${orgName}, Please register first.` });
    }
});


// Invoke transaction on chaincode on target peers
app.post('/channels/:channelName/chaincodes/:chaincodeName', async function (req, res) {
    try {
        logger.debug('==================== INVOKE ON CHAINCODE ==================');
        var peers = req.body.peers;
        var chaincodeName = req.params.chaincodeName;
        var channelName = req.params.channelName;
        var fcn = req.body.fcn;
        var args = req.body.args;
        var transient = req.body.transient;
        console.log(`Transient data is ;${transient}`)
        logger.debug('channelName  : ' + channelName);
        logger.debug('chaincodeName : ' + chaincodeName);
        logger.debug('fcn  : ' + fcn);
        logger.debug('args  : ' + args);
        if (!chaincodeName) {
            res.json(getErrorMessage('\'chaincodeName\''));
            return;
        }
        if (!channelName) {
            res.json(getErrorMessage('\'channelName\''));
            return;
        }
        if (!fcn) {
            res.json(getErrorMessage('\'fcn\''));
            return;
        }
        if (!args) {
            res.json(getErrorMessage('\'args\''));
            return;
        }

        let message = await invoke.invokeTransaction(channelName, chaincodeName, fcn, args, req.username, req.orgname, transient);
        console.log(`message result is : ${message}`)

        const response_payload = {
            result: message,
            error: null,
            errorData: null
        }
        res.send(response_payload);

    } catch (error) {
        const response_payload = {
            result: null,
            error: error.name,
            errorData: error.message
        }
        res.send(response_payload)
    }
});

// HACER CONTRIBUCIÓN
app.post('/contribution/make', async function (req, res) {
    var campaignId = req.body.campaignId;
    var donorId = req.body.donorId;
    var amount = req.body.amount;
    var orgName = req.body.orgName; // Asegúrate de pasar la organización del usuario
    var username = req.body.username; // Asegúrate de pasar el username del usuario

    logger.debug('End point : /contribution/make');
    logger.debug('Campaign ID : ' + campaignId);
    logger.debug('Donor ID : ' + donorId);
    logger.debug('Amount : ' + amount);

    if (!campaignId) {
        res.json(getErrorMessage('\'campaignId\''));
        return;
    }
    if (!donorId) {
        res.json(getErrorMessage('\'donorId\''));
        return;
    }
    if (!amount) {
        res.json(getErrorMessage('\'amount\''));
        return;
    }
    if (!orgName) {
        res.json(getErrorMessage('\'orgName\''));
        return;
    }
    if (!username) {
        res.json(getErrorMessage('\'username\''));
        return;
    }

    try {
        let response = await helper.makeContribution(campaignId, donorId, amount, orgName, username);
        logger.debug('Successfully submitted contribution transaction for campaign ID %s by donor ID %s', campaignId, donorId);

        // Generate a unique transaction ID
        var transactionId = crypto.randomBytes(20).toString('hex');
        response.transactionId = transactionId;
        res.json(response);
    } catch (error) {
        logger.error('Failed to submit contribution transaction: %s', error.message);
        res.json({ success: false, message: error.message });
    }
});

function getErrorMessage(field) {
    return {
        success: false,
        message: `Missing required field ${field}`
    };
}

app.get('/channels/:channelName/chaincodes/:chaincodeName', async function (req, res) {
    try {
        logger.debug('==================== QUERY BY CHAINCODE ==================');

        var channelName = req.params.channelName;
        var chaincodeName = req.params.chaincodeName;
        console.log(`chaincode name is :${chaincodeName}`)
        let args = req.query.args;
        let fcn = req.query.fcn;
        let peer = req.query.peer;

        logger.debug('channelName : ' + channelName);
        logger.debug('chaincodeName : ' + chaincodeName);
        logger.debug('fcn : ' + fcn);
        logger.debug('args : ' + args);

        if (!chaincodeName) {
            res.json(getErrorMessage('\'chaincodeName\''));
            return;
        }
        if (!channelName) {
            res.json(getErrorMessage('\'channelName\''));
            return;
        }
        if (!fcn) {
            res.json(getErrorMessage('\'fcn\''));
            return;
        }
        if (!args) {
            res.json(getErrorMessage('\'args\''));
            return;
        }
        console.log('args==========', args);
        args = args.replace(/'/g, '"');
        args = JSON.parse(args);
        logger.debug(args);

        let message = await query.query(channelName, chaincodeName, args, fcn, req.username, req.orgname);

        const response_payload = {
            result: message,
            error: null,
            errorData: null
        }

        res.send(response_payload);
    } catch (error) {
        const response_payload = {
            result: null,
            error: error.name,
            errorData: error.message
        }
        res.send(response_payload)
    }
});

// LISTAR CONTRIBUCIONES DE UN USUARIO
app.get('/contribution/user/:userId', async function (req, res) {
    var userId = req.params.userId;
    var orgName = req.query.orgName; // Asegúrate de pasar la organización del usuario
    var username = req.query.username; // Asegúrate de pasar el username del usuario

    logger.debug('End point : /contribution/user/' + userId);
    logger.debug('User ID : ' + userId);

    if (!userId) {
        res.json(getErrorMessage('\'userId\''));
        return;
    }
    if (!orgName) {
        res.json(getErrorMessage('\'orgName\''));
        return;
    }
    if (!username) {
        res.json(getErrorMessage('\'username\''));
        return;
    }

    try {
        let contributions = await helper.getContributionsByUser(userId, orgName, username);
        res.json({
            success: true,
            contributions: contributions
        });
    } catch (error) {
        logger.error('Error fetching contributions for user %s: %s', userId, error.message);
        res.json({
            success: false,
            message: 'Error fetching contributions'
        });
    }
});



// LISTAR CONTRIBUCIONES DE UNA CAMPAÑA
app.get('/contribution/get/:campaignId', async function (req, res) {
    var campaignId = req.params.campaignId;
    var orgName = req.query.orgName; // Asegúrate de pasar la organización del usuario
    var username = req.query.username; // Asegúrate de pasar el username del usuario

    logger.debug('End point : /contribution/get/' + campaignId);
    logger.debug('Campaign ID : ' + campaignId);

    if (!campaignId) {
        res.json(getErrorMessage('\'campaignId\''));
        return;
    }
    if (!orgName) {
        res.json(getErrorMessage('\'orgName\''));
        return;
    }
    if (!username) {
        res.json(getErrorMessage('\'username\''));
        return;
    }

    try {
        let contributions = await helper.getContributionsForCampaign(campaignId, orgName, username);
        res.json({
            success: true,
            contributions: contributions
        });
    } catch (error) {
        logger.error('Error fetching contributions for campaign %s: %s', campaignId, error.message);
        res.json({
            success: false,
            message: 'Error fetching contributions'
        });
    }
});

function getErrorMessage(field) {
    return {
        success: false,
        message: `Missing required field ${field}`
    };
}


app.get('/qscc/channels/:channelName/chaincodes/:chaincodeName', async function (req, res) {
    try {
        logger.debug('==================== QUERY BY CHAINCODE ==================');

        var channelName = req.params.channelName;
        var chaincodeName = req.params.chaincodeName;
        console.log(`chaincode name is :${chaincodeName}`)
        let args = req.query.args;
        let fcn = req.query.fcn;
        // let peer = req.query.peer;

        logger.debug('channelName : ' + channelName);
        logger.debug('chaincodeName : ' + chaincodeName);
        logger.debug('fcn : ' + fcn);
        logger.debug('args : ' + args);

        if (!chaincodeName) {
            res.json(getErrorMessage('\'chaincodeName\''));
            return;
        }
        if (!channelName) {
            res.json(getErrorMessage('\'channelName\''));
            return;
        }
        if (!fcn) {
            res.json(getErrorMessage('\'fcn\''));
            return;
        }
        if (!args) {
            res.json(getErrorMessage('\'args\''));
            return;
        }
        console.log('args==========', args);
        args = args.replace(/'/g, '"');
        args = JSON.parse(args);
        logger.debug(args);

        let response_payload = await qscc.qscc(channelName, chaincodeName, args, fcn, req.username, req.orgname);

        // const response_payload = {
        //     result: message,
        //     error: null,
        //     errorData: null
        // }

        res.send(response_payload);
    } catch (error) {
        const response_payload = {
            result: null,
            error: error.name,
            errorData: error.message
        }
        res.send(response_payload)
    }
});
