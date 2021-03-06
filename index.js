/*jshint esversion: 6 */

const
  bodyParser = require('body-parser'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),
  request = require('request');
  uuidGenerator = require('node-uuid');
  split_literal = ";;/;;";
  url = require('url');
  yolo_code = "yolo_code_456";

// connection pool
const { Pool } = require('pg');
const params = url.parse(process.env.DATABASE_URL);
const auth = params.auth.split(':'); 
const config = {
  user: auth[0],
  password: auth[1],
  host: params.hostname,
  port: params.port,
  database: params.pathname.split('/')[1],
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
  ssl: true
};
const pool = new Pool(config);

var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
  extended: false
}));
// Process application/json
app.use(bodyParser.json());

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
      var pageId = pageEntry.id;
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
  var senderId = event.sender.id;
  var recipientId = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message: %s",
    senderId, recipientId, timeOfMessage, JSON.stringify(message));

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

  console.log("Message text: %s", messageText);
  if (messageText) {
    // If we receive a text message, check to see if it matches any special
    // keywords and send back the corresponding example. Otherwise, just echo
    // the text we received.

    var cleanMessageText = messageText.toLowerCase().trim();
    var split = cleanMessageText.split(" ");
    var keyword = split[0];
    var keyword_end = 1;
    if (split.length >= 2) {
      var word2 = split[1];
      if (word2 === "game" || word2 === "games") {
        keyword_end = 2;
      }
    }
    var remainingSplit = split.slice(keyword_end);
    var remainingMessage = remainingSplit.join(" ");
    var valid_prefixes = ["#"];
    var valid_suffixes = ["-game", "-games"];
    for (var i = 0; i < valid_prefixes.length; i ++) {
      var valid_prefix = valid_prefixes[i];
      if (keyword.startsWith(valid_prefix)) {
        keyword = keyword.substring(valid_prefix.length);
      }
    }
    for (var j = 0; j < valid_suffixes.length; j ++) {
      var valid_suffix = valid_suffixes[j];
      if (keyword.endsWith(valid_suffix)) {
        keyword = keyword.substring(0, keyword.length - valid_suffix.length);
      }
    }
    if (!switchCases(senderId, keyword, remainingMessage)) {
      sendInvalidMessage(senderId);
    }
  } else if (messageAttachments) {
    sendInvalidMessage(senderId);
  }
}

function switchCases(senderId, keyword, remainingMessage) {
  switch (keyword) {
    case 'help':
      sendHelpMessage(senderId);
      break;

    case 'create':
      createGame(senderId);
      break;

    case 'create-yolo':
    case 'createyolo':
    case 'yolo-create':
    case 'yolocreate':
      createGame(senderId, yolo_code);
      break;

    case 'join':
      joinGame(senderId, remainingMessage);
      break;

    case 'yolo':
    case 'join-yolo':
    case 'joinyolo':
    case 'yolo-join':
    case 'yolojoin':
      joinGameWithCode(senderId, yolo_code);
      break;

    case 'list':
      listGames(senderId);
      break;

    case 'start':
    case 'begin':
      startGame(senderId);
      break;

    case 'exit':
    case 'quit':
    case 'leave':
      exitGame(senderId);
      break;

    default:
      return false;
  }
  return true;
}

function generateCode() {
  var ret = Math.floor(1000 + Math.random() * 9000);
  ret = ret.toString();
  return ret.substring(-2);
}

function createGame(recipientId, code = generateCode()) {
  resolveName(recipientId, function(recipientString) {
    if (recipientString === null) {
      sendErrorMessage(recipientId, "Failed to resolve user's identity");
      return;      
    }
    pool.connect(function(err, client, release) {
      if (err) {
        release();
        sendErrorMessage(recipientId, "Connecting to the DB failed with error " + err);
        return;
      }

      client.query("SELECT * FROM new_games WHERE creator_id = $1", [recipientId], function (err, results) {
        if (err) {
          release();
          sendErrorMessage(recipientId, "Getting the list of active games your created failed with error " + err);
          return;
        }
        if (results.rowCount >= 1) {
          release();
          sendTextMessage(recipientId, "You already have an active game. Use either 'start' or 'exit' to clear that game first before creating a new game");
          return;
        }

        var uuid = uuidGenerator.v4();
        client.query("INSERT INTO new_games VALUES ($1, $2, $3, $4, current_timestamp);", [uuid, code, recipientId, [ recipientString ]], function (err, result) {
          release();
          if (err) {
            sendErrorMessage(recipientId, "Creating game failed with error " + err);
            return;
          }
          if (code === yolo_code) {
            sendTextMessage(recipientId, "Successfully a secret game. Ask participants to send 'yolo' to join this game");
          } else {
            sendTextMessage(recipientId, "Successfully created the game. Use code " + code);
          }
        });
      });
    });
  });
}

function joinGame(recipientId, message) {
  var split = message.split(" ");
  if (split.length != 1) {
    sendTextMessage(recipientId, "Invalid syntax. The correct syntax is 'join <code>'");
    return;
  }
  var code = split[0];
  code = code.replace("<", "");
  code = code.replace(">", "");
  if (code.length != 4) {
    sendTextMessage(recipientId, "Invalid syntax. The code should be a 4 digit number");
    return;
  }
  joinGameWithCode(recipientId, code); 
}

function joinGameWithCode(recipientId, code) {
  resolveName(recipientId, function(recipientString) {
    if (recipientString === null) {
      sendErrorMessage(recipientId, "Failed to resolve user's identity");
      return;      
    }
    pool.query("UPDATE new_games SET players = array_append(players,$1) WHERE code = $2 RETURNING *", [recipientString, code], function (err, result) {
      if (err) {
        sendErrorMessage(recipientId, "Joining the game failed with error " + err);
        return;
      }
      if (result.rowCount === 0) {
        if (code === yolo_code) {
          sendTextMessage(recipientId, "No secret game is present. Create a game first.");
        } else {
          sendTextMessage(recipientId, "A game with the code " + code + " was not found. Are you sure you have the right code?");
        }
        return;
      } else if (result.rowCount > 1) {
        sendErrorMessage(recipientId, "Something went wrong (Multiple games were found with the same code). Please contact the developer");
        return;
      }
      sendTextMessage(recipientId, "Successfully joined the game");
      var recipient = splitIdAndName(recipientString);
      var creatorId = result.rows[0].creator_id;
      if (recipientId !== creatorId) {
        sendTextMessage(creatorId, recipient.userName + " joined the game");
      }
    });
  });
}

function startGame(recipientId) {
  pool.connect(function(err, client, release) {
    if (err) {
      release();
      sendErrorMessage(recipientId, "Connecting to the DB failed with error " + err);
      return;
    }

    queryOwnGames(client, recipientId, function(code, players) {
      if (players === null) {
        // queryGames notifies the user about this
        release();
        return;        
      }
      if (players.length === 0) { 
        release();
        sendTextMessage(recipientId, "You do not have any current active games");
        return;        
      }
      if (players.length < 5 || players.length > 10) {
        release();
        var verbString = (players.length == 1) ? "is" : "are";
        var playerString = (players.length == 1) ? "player" : "players";
        sendTextMessage(recipientId, "Avalon needs 5-10 players. There " + verbString + " currently just " + players.length + "  " + playerString + " in this game");
        return;
      }
      setupGame(players, recipientId);
      client.query("DELETE FROM new_games WHERE creator_id = $1", [recipientId], function (err, results) {
        release();
        if (err) {
          sendErrorMessage(recipientId, "Cleared started game failed with error " + err);
        } else {
          console.log("AvalonLog: Successfuly started and then deleted the game");
        }
      });
    });
  });
}

function listGames(recipientId) {
  pool.connect(function(err, client, release) {
    if (err) {
      release();
      sendErrorMessage(recipientId, "Connecting to the DB failed with error " + err);
      return;
    }

    queryOwnGames(client, recipientId, function(code, players) {
      release();
      if (players === null) {
        // queryGames notifies the user about this
        return;        
      }
      if (players.length === 0) { 
        sendTextMessage(recipientId, "You do not have any current active games");
        return;        
      }
      if (code === yolo_code) {
        code = "<secret-code>";
      }
      var message = "You have 1 active game\n" +
        "Code: " + code + "\n" +
        "Current players: " + nameStringFromPlayers(players);
      sendTextMessage(recipientId, message);
    });
  });
}

function exitGame(recipientId) {
  pool.query("DELETE FROM new_games WHERE creator_id = $1", [recipientId], function (err, results) {
    if (err) {
      sendErrorMessage(recipientId, "Exiting game failed with error " + err);
      return;
    }
    sendTextMessage(recipientId, "Exited all games that you created");
  });
}

function queryOwnGames(client, creatorId, callback) {
  client.query("SELECT * FROM new_games WHERE creator_id = $1", [creatorId], function (err, results) {
    if (err) {
      sendErrorMessage(creatorId, "Getting the list of active games your created failed with error " + err);
      callback(null, null);
      return;
    }
    console.log("AvalonLog: Listing games, there are %d games", results.rowCount);
    if (results.rowCount === 0) {
      callback(null, []);
      return;        
    }
    if (results.rowCount > 1) {
      sendErrorMessage(creatorId, "I found multiple active games created by you. Clearing all your games. Please create a new game.");
      exitGame(creatorId);
      callback(null, null);
      return;        
    }
    var row = results.rows[0];
    var players = row.players;
    players = uniqueArray(players);
    console.log("AvalonLog: There are %d unique players. Players: %s", players.length, JSON.stringify(players));
    callback(row.code, playersFromPlayerStrings(players));
  });
}

function sendHelpMessage(recipientId) {
  var message = "Supported keywords:\n\n" +
    "create : Create a new game\n" +
    "join <code word> : Join the game with the matching code word\n" +
    "start : Start game. Only the creator can start the game\n" +
    "list : List all the games you have created that are currently active\n" +
    "exit : Exit games that you have created";
  sendTextMessage(recipientId, message);
}

function sendErrorMessage(recipientId, reason) {
  sendTextMessage(recipientId, "I encountered an error. Reason: " + reason);
}

function sendInvalidMessage(recipientId) {
  sendTextMessage(recipientId, "Sorry, I'm not sure what you are trying to say. :(");
  sendHelpMessage(recipientId);
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

function resolveName(userId, callback) {
  url = "https://graph.facebook.com/v2.6/" + userId + "?fields=first_name,last_name&access_token=" + FB_PAGE_ACCESS_TOKEN;
  request(url, function(error, response, body) {
    if (!error && response.statusCode == 200) {
      var parsedBody = JSON.parse(body);
      var firstName = parsedBody.first_name;
      var lastName = parsedBody.last_name;
      var name = firstName + " " + lastName;
      console.log("Successfully resolved name to %s", name);
      callback(combineIdAndName(userId, name));
    } else {
      console.error("Failed resolving name", response.statusCode, response.statusMessage, body.error);
      callback(null);
    }
  });
}

function combineIdAndName(userId, name) {
  // TODO: this is hacky. Split this out into separate columbs
  return userId + split_literal + name;
}

function splitIdAndName(combination) {
  var split = combination.split(split_literal);
  if (split.length != 2) {
    console.log("AvalonLog: Invalid combination to split: %s op: %s", combination, split);
    return null;
  }
  return {userId : split[0], userName: split[1]};
}

function playersFromPlayerStrings(playerStrings) {
  var ret = [];
  for (var i = 0; i < playerStrings.length; i ++) {
    var playerString = playerStrings[i];
    var player = splitIdAndName(playerString);
    if (player !== null) {
      ret.push(player);
    }
  }
  return ret;
}

function nameStringFromPlayers(players) {
  if (players.length === 0) {
    // Should not happen
    return null;
  }
  var ret = players[0].userName;
  for (var i = 1; i < players.length; i ++) {
    if (i == players.length - 1) {
      ret += " and";
    } else {
      ret += ",";
    }
    ret += (" " + players[i].userName);
  }
  return ret;
}

function setupGame(players, creatorId)
{
  players = shuffleArray(players);
  var playerCount = players.length;
  if (playerCount < 5 || playerCount > 10) {
    // Should not happen
    console.log("AvalonLog: Invalid player count %d while setting up the game", playerCount);
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
  roles_known_to_merlin = shuffleArray(roles_known_to_merlin);
  roles_known_to_percival = shuffleArray(roles_known_to_percival);
  roles_known_to_spies = shuffleArray(roles_known_to_spies);

  var creator_name = null;
  for (var i = 0; i < players.length; i++) {
    var player = players[i];
    if (player.userId === creatorId) {
      creator_name = player.userName;
    }
  }

  var prefix = "The game" + ((creator_name === null) ? "" : (", created by " + creator_name + ",")) + " has started\n";

  sendTextMessage(role_merlin.userId, prefix + "Your role is 'Merlin'.\nThe known spies are " + nameStringFromPlayers(roles_known_to_merlin) + ".");
  sendTextMessage(role_percival.userId, prefix + "Your role is 'Percival'.\n" + nameStringFromPlayers(roles_known_to_percival) + " are either 'Merlin' or 'Morgana'");
  sendTextMessage(role_morgana.userId, prefix + "Your role is 'Morgana'.");
  sendTextMessage(role_mordred.userId, prefix + "Your role is 'Mordred'.");
  if (role_oberon !== null) {
    sendTextMessage(role_oberon.userId, prefix + "Your role is 'Oberon'.");
  }
  if (role_spy !== null) {
    sendTextMessage(role_spy.userId, prefix + "Your role is 'A mininon of Mordred'.");
  }
  for (i = 0; i < roles_known_to_spies.length; i++) {
    var known_spy = roles_known_to_spies[i];
    sendTextMessage(known_spy.userId, "The spies who know each other are " + nameStringFromPlayers(roles_known_to_spies) + ".");
  }
  for (; index < playerCount; index++) {
    sendTextMessage(players[index].userId, prefix + "Your role is 'A loyal servant of Arthur'.");
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