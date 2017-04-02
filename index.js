/*jshint esversion: 6 */

const
  bodyParser = require('body-parser'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),
  request = require('request');
  pg = require('pg');
  uuidGenerator = require('node-uuid');

var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
  extended: false
}));
// Process application/json
app.use(bodyParser.json());
pg.defaults.ssl = true;

// Generate a page access token for your page from the App Dashboard
const FB_PAGE_ACCESS_TOKEN = (process.env.FB_PAGE_ACCESS_TOKEN) ? (process.env.FB_PAGE_ACCESS_TOKEN) : config.get('pageAccessToken');

// for Facebook verification
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === 'my_voice_is_my_password_verify_me') {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
});

// Index route
app.get('/', function(req, res) {
  res.send('Hello world, I am a chat bot');
});

// webhook
app.post('/webhook', function(req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've 
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:",
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s",
      messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
      messageId, quickReplyPayload);
    return;
  }

  if (messageText) {
    // If we receive a text message, check to see if it matches any special
    // keywords and send back the corresponding example. Otherwise, just echo
    // the text we received.

    var cleanMessageText = messageText.toLowerCase().trim();
    var split = cleanMessageText.split(" ");
    switch (split[0]) {
      case '#help':
        sendHelpMessage(senderID);
        break;

      case '#create':
        createGame(senderID);
        break;

      case '#join':
        joinGame(senderID, cleanMessageText);
        break;

      case '#create':
        startGame(senderID);
        break;

      case '#end':
        endGame(senderID);
        break;

      default:
        sendInvalidMessage(senderID);
    }
  } else if (messageAttachments) {
    sendInvalidMessage(senderId);
  }
}

function generateCode() {
  var ret = Math.floor(100000 + Math.random() * 900000);
  ret = ret.toString();
  return ret.substring(-2);
}

function createGame(recipientId) {
  pg.connect(process.env.DATABASE_URL, function(err, client) {
    if (err) {
      sendErrorMessage(recipientId, "Connecting to the DB failed with error " + err);
      return;
    }

    var uuid = uuidGenerator.v4();
    var code = generateCode();
    client.query("INSERT INTO new_games VALUES ($1, $2, $3, $4, current_timestamp);", [uuid, code, recipientId, [ recipientId ]], function (err, result) {
      if (err) {
        sendErrorMessage(recipientId, "Creating game failed with error " + err);
        pg.end();
        return;
      }
      sendTextMessage(recipientId, "Successfully created the game. Use code# " + code);
      pg.end();
    });
  });
}

function joinGame(recipientId, message) {
  var split = message.split(" ");
  if (split.length != 2) {
    sendTextMessage(recipientId, "Invalid syntax. The correct syntax is '#join <code>'");
    return;
  }
  var code = split[1];
  if (code.length != 6) {
    sendTextMessage(recipientId, "Invalid syntax. The code should be a 6 digit number");
    return;
  }

  pg.connect(process.env.DATABASE_URL, function(err, client) {
    if (err) {
      sendErrorMessage(recipientId, "Connecting to the DB failed with error " + err);
      return;
    }
    client.query("UPDATE new_games SET players = array_append(players,$1) WHERE code = $2 RETURNING *", [recipientId, code], function (err, result) {
      if (err) {
        sendErrorMessage(recipientId, "Joining the game failed with error " + err);
        pg.end();
        return;
      }
      if (result.rowCount === 0) {
        sendTextMessage(recipientId, "A game with the code " + code + " was not found. Are you sure you have the right code?");
        pg.end();
        return;
      } else if (result.rowCount > 1) {
        sendErrorMessage(recipientId, "Something went wrong (Multiple games were found with the same code). Please contact the developer");
        pg.end();
        return;
      }
      sendTextMessage(recipientId, "Successfully joined the game");
      sendTextMessage(result.rows[0].creator_id, recipientId + " joined the game");
      pg.end();
    });
  });
}

function startGame(recipientId) {
  pg.connect(process.env.DATABASE_URL, function(err, client) {
    if (err) {
      sendErrorMessage(recipientId, "Connecting to the DB failed with error " + err);
      return;
    }

    var uuid = uuidGenerator.v4();
    var code = generateCode();
    client.query("SELECT * FROM new_games WHERE creator_id = $1);", [recipientId], function (err, results) {
      if (err) {
        sendErrorMessage(recipientId, "Starting game failed with error " + err);
        pg.end();
        return;
      }
      if (results.rows.count === 0) {
        sendTextMessage(recipientId, "Could not find a game to start. Only creators are allowed to start games");
        pg.end();
        return;        
      }
      if (results.rows.count > 1) {
        sendTextMessage(recipientId, "You created multiple games. Only the first game would be started");
      }
      var row = results.rows[0];
      var players = row.players;
      players.push(recipientId);
      players = uniqueArray(players);
      if (players.count < 5 || players.count > 10) {
        sendTextMessage(recipientId, "Avalon needs 5-10 players. There are currently " + players.count + "  players in this game");
        pg.end();
        return;
      }
      setupGame(players);
      client.query("DELETE FROM new_games WHERE id = $1);", [row.id], function (err, results) {
        if (err) {
          sendErrorMessage(recipientId, "Cleared started game failed with error " + err);
        }
        pg.end();
      });
    });
  });
}

function sendHelpMessage(recipientId) {
  var message = "Supported options:\n" +
    "#create : Create a new game\n" +
    "#join <code word> : Join the game with the matching code word\n" +
    "#start : Start game\n" +
  sendTextMessage(recipientId, message);
}

function sendErrorMessage(recipientId, reason) {
  sendTextMessage(recipientId, "I encountered an error. Reason: " + reason);
}

function sendInvalidMessage(recipientId) {
  sendTextMessage(recipientId, "I'm not that smart yet. Send #help to learn more about my limited vocabulary");
}

function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: {
      access_token: FB_PAGE_ACCESS_TOKEN
    },
    method: 'POST',
    json: messageData

  }, function(error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s",
          messageId, recipientId);
      } else {
        console.log("Successfully called Send API for recipient %s",
          recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });
}

function setupGame(players)
{
  players = shuffleArray(players);
  var playerCount = players.count;
  if (playerCount < 5 || playerCount > 10) {
    // Should not happen
    return;
  }
  var index = 0;
  var role_merlin = players[index++];
  var role_percival = players[index++];
  var role_morgana = players[index++];
  var role_mordred = players[index++];
  var roles_known_to_merlin = [role_morgana];
  var roles_known_to_percival = [role_morgana, role_merlin];
  var roles_known_to_spies = [role_morgana, role_mordred];
  var role_oberon = null;
  var role_spy = null;
  if (playerCount >= 7) {
     role_oberon = players[index++];
     roles_known_to_merlin.push(role_oberon);
  }
  if (playerCount == 10) {
    role_spy = players[index++];
    roles_known_to_spies.push(role_spy);
  }

  sendTextMessage(role_merlin, "The game has started.\n You are 'Merlin'.\n The known spies are " + roles_known_to_merlin);
  sendTextMessage(role_percival, "The game has started.\n You are 'Percival'.\n" + roles_known_to_merlin + " are either 'Merlin' or 'Morgana'");
  sendTextMessage(role_morgana, "The game has started.\n You are 'Morgana'.");
  sendTextMessage(role_mordred, "The game has started.\n You are 'Mordred'.");
  if (role_oberon !== null) {
    sendTextMessage(role_oberon, "The game has started.\n You are 'Oberon'.");
  }
  if (role_spy !== null) {
    sendTextMessage(role_spy, "The game has started.\n You are 'A Mininon of Mordred'.");
  }
  for (var spy in roles_known_to_spies) {
    sendTextMessage(spy, "The known spies are " + roles_known_to_spies);
  }
  for (; index < playerCount; index++) {
    sendTextMessage(role_spy, "The game has started.\n You are 'A Loyal Servant of Arthur'.");    
  }
}

function uniqueArray(arr) {
  return arr.filter(function(elem, pos) {
    return arr.indexOf(elem) == pos;
  });
}

function shuffleArray(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
}

// Spin up the server
app.listen(app.get('port'), function() {
  console.log('running on port', app.get('port'));
});

module.exports = app;