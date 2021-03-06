"use strict";

var RECONNECT_DELAY = timespan.milliseconds(500);
var RECONNECT_TRIES = 10;

var TOKEN_REFRESH_TIMER = timespan.minutes(30);
var TOKEN_RENEW_SOFT = timespan.days(1);
var TOKEN_RENEW_HARD = timespan.minutes(5);

var INNER_DEMON_CHECK_TIMER = timespan.minutes(15);

var SOCKET_PING_TIMER_VISIBLE = timespan.seconds(5);
var SOCKET_PING_TIMER_HIDDEN = timespan.minutes(1);
var SOCKET_PONG_TIMEOUT = timespan.seconds(5);

var APPLE_WEBKIT_RE = /\bAppleWebKit\/([0-9]+)\.([0-9]+)\b/;

function NetworkError(msg) {
  this.msg = msg;
}
NetworkError.prototype.toString = function() {
  return "Network error";
};
function HttpError(status, statusText, responseText) {
  this.status = status;
  this.statusText = statusText;
  this.responseText = responseText;
}
HttpError.prototype.toString = function() {
  return this.responseText;
};

function corsRequest(method, url, data) {
  var xhr = new XMLHttpRequest();
  var isXdr = false;
  if ("withCredentials" in xhr) {
    // XHR with CORS
    xhr.open(method, url, true);
  } else if (typeof XDomainRequest != "undefined") {
    // XDomainRequest for IE9.
    xhr = new XDomainRequest();
    xhr.open(method, url);
    isXdr = true;
  } else {
    return Q.reject("CORS not supported.");
  }

  var deferred = Q.defer();
  xhr.onload = function() {
    if (isXdr || this.status == 200) {
      deferred.resolve(this.responseText);
    } else if (this.status) {
      deferred.reject(new HttpError(this.status, this.statusText,
                                    this.responseText));
    } else {
      deferred.reject(new NetworkError());
    }
  };
  xhr.onerror = function() {
    deferred.reject("Request failed");
  };
  if (isXdr) {
    // Apparently IE gets grumpy about missing callbacks... wat?q
    xhr.onprogress = function() { };
    xhr.ontimeout = function() { };
  }

  if (isXdr) {
    // Mumble cached requests mumble? I don't... think I care? Either
    // way, avoid silliness.
    setTimeout(function() {
      if (data !== undefined) {
        xhr.send(JSON.stringify(data));
      } else {
        xhr.send();
      }
      data = undefined;  // Meh. It's in all the closures in V8 now. Release it.
    }, 0);
  } else {
    if (data !== undefined) {
      // The server accepts text/plain as application/json. For CORS as
      // an optimization to avoid the preflight. For IE9
      // (XDomainRequest) as a necessity. (It accepts application/json
      // just fine too, of course.)
      xhr.setRequestHeader("Content-Type", "text/plain");

      // Wat. Work around Chrome/Safari NFC normalizing text before in
      // XMLHttpRequest#send. This seems to date back to something
      // Apple put in WebKit for Mail.app. The form submission part
      // was removed in Blink, but not XHR. Also it's still in Safari.
      //
      // The cleanest fix would be to use XHR2's ArrayBufferView
      // version of send. BUT they messed that one up and used
      // ArrayBuffer first. ArrayBufferView support may go away and
      // isn't really detectable, so...
      //
      // UA-sniff AppleWebKit and use the version to gate whether we
      // use AB or ABV. This way the risk is limited to the engine
      // which needs the workaround. In parallel try to get this fixed
      // in Chrome at least so we only care about Safari.
      var m;
      var dataJson = JSON.stringify(data);
      if (window.FormData /* XHR2 support */ &&
          (m = APPLE_WEBKIT_RE.exec(navigator.userAgent))) {
        var webkitVersionMajor = Number(m[1]);
        var webkitVersionMinor = Number(m[2]);
        // ABV added in Chrome 22, which is WebKit 537.4. (Is there a
        // finer-grained cutoff? Judging from Safari version history,
        // we don't care?)
        if (webkitVersionMajor > 537 ||
            (webkitVersionMajor == 537 && webkitVersionMinor >= 4)) {
          xhr.send(arrayutils.fromString(dataJson));
        } else {
          xhr.send(arrayutils.fromString(dataJson).buffer);
        }
      } else {
        xhr.send(dataJson);
      }
    } else {
      xhr.send();
    }
    data = undefined;  // Meh. It's in the closure in V8 now. Release it.
  }
  return deferred.promise;
}

if (typeof document.hidden === "undefined") {
  if (window.console && console.log)
    console.log("Page visibility API not supported.");
}

function RoostSocket(sockJS) {
  RoostEventTarget.call(this);
  this.sockJS_ = sockJS;
  this.sockJS_.addEventListener("message", this.onMessage_.bind(this));
  this.sockJS_.addEventListener("close", this.onClose_.bind(this));

  this.ready_ = false;
  this.pingVisible_ = null;
  this.pingHidden_ = null;

  this.pongTimer_ = null;
  this.onVisibilityChangeCb_ = this.onVisibilityChange_.bind(this);
  document.addEventListener("visibilitychange", this.onVisibilityChangeCb_);
};
RoostSocket.prototype = Object.create(RoostEventTarget.prototype);
RoostSocket.prototype.sockJS = function() {
  return this.sockJS_;
};
RoostSocket.prototype.onMessage_ = function(ev) {
  // Heard from the server. Stop the pong timer.
  if (this.pongTimer_ != null) {
    clearTimeout(this.pongTimer_);
    this.pongTimer_ = null;
  }
  var msg = JSON.parse(ev.data);
  if (msg.type === "ready") {
    this.ready_ = true;
    this.onVisibilityChangeCb_();
  }
  this.dispatchEvent(msg);
};
RoostSocket.prototype.send = function(msg) {
  this.sockJS_.send(JSON.stringify(msg));
};
RoostSocket.prototype.onVisibilityChange_ = function(ev) {
  if (!this.ready_)
    return;
  // Send a new ping if it's time to.
  if ((document.hidden && (this.pingHidden_ == null)) ||
      (!document.hidden && (this.pingVisible_ == null))) {
    this.sendPing_();
  }
};
RoostSocket.prototype.sendPing_ = function() {
  this.send({type: "ping"});

  // Refresh the pong timer, assuming there isn't already one. (If
  // there is, let it keep running.)
  if (this.pongTimer_ == null) {
    this.pongTimer_ = setTimeout(function() {
      // Didn't hear from the server for too long.
      if (window.console && console.log)
        console.log("No response from server");
      this.sockJS_.close();
    }.bind(this), SOCKET_PONG_TIMEOUT);
  }

  // Flag for whether the timeout for visible has passed. We do it
  // this way instead of creating and tearing down timers on
  // visibilitychange so that things don't act funny if visibility
  // state switches like crazy or something.
  if (this.pingVisible_ != null)
    clearTimeout(this.pingVisible_);
  this.pingVisible_ = setTimeout(function() {
    this.pingVisible_ = null;
    this.onVisibilityChange_();
  }.bind(this), SOCKET_PING_TIMER_VISIBLE);

  // Flag for whether the timeout for hidden has passed.
  if (this.pingHidden_ != null)
    clearTimeout(this.pingHidden_);
  this.pingHidden_ = setTimeout(function() {
    this.pingHidden_ = null;
    this.onVisibilityChange_();
  }.bind(this), SOCKET_PING_TIMER_HIDDEN);
};
RoostSocket.prototype.onClose_ = function(ev) {
  // Shut off all timers.
  if (this.pongTimer_ != null) {
    clearTimeout(this.pongTimer_);
    this.pongTimer_ = null;
  }
  if (this.pingVisible_ != null) {
    clearTimeout(this.pingVisible_);
    this.pingVisible_ = null;
  }
  if (this.pingHidden_ != null) {
    clearTimeout(this.pingHidden_);
    this.pingHidden_ = null;
  }
  // Stop listening for visibility changes.
  document.removeEventListener("visibilitychange", this.onVisibilityChangeCb_);
  this.ready_ = false;
};

/* State-saving code: */
var CHARCODE_a = 'a'.charCodeAt(0);
function generateId() {
  var chars = [];
  for (var i = 0; i < 10; i++) {
    chars.push(String.fromCharCode(
      CHARCODE_a + Math.floor(Math.random() * 26)))
  }
  return chars.join("");
}

function API(urlBase, servicePrincipal, storageManager, ticketManager) {
  RoostEventTarget.call(this);

  this.clientId_ = generateId();

  this.urlBase_ = urlBase;
  this.storageManager_ = storageManager;
  this.ticketManager_ = ticketManager;
  this.peer_ = gss.Name.importName(servicePrincipal,
                                   gss.KRB5_NT_PRINCIPAL_NAME);

  this.token_ = null;
  this.tokenDeferred_ = Q.defer();
  this.tokenPending_ = false;

  this.socket_ = null;
  this.socketPending_ = false;
  this.reconnectDelay_ = RECONNECT_DELAY;
  this.reconnectTries_ = RECONNECT_TRIES;
  this.nextTailId_ = 1;

  setTimeout(this.tryConnectSocket_.bind(this), 0);
  setTimeout(this.checkInnerDemon_.bind(this), 0);

  this.loadTokenFromStorage_();
  this.storageManager_.addEventListener(
    "change", this.loadTokenFromStorage_.bind(this));

  this.userInfo_ = new UserInfo(this);

  window.setInterval(this.checkExpiredToken_.bind(this),
                     TOKEN_REFRESH_TIMER);

  // If we go online, try to reconnect then and there.
  window.addEventListener("online", this.tryConnectSocket_.bind(this));
}
API.prototype = Object.create(RoostEventTarget.prototype);

API.prototype.userInfo = function() {
  return this.userInfo_;
};

API.prototype.handleNewToken_ = function(token, expires) {
  // Save locally.
  this.token_ = { value: token, expires: expires };
  // Notify blockers.
  this.tokenDeferred_.resolve(token);
  this.tokenDeferred_ = Q.defer();
};

API.prototype.loadTokenFromStorage_ = function() {
  var data = this.storageManager_.data();
  if (data && data.token &&
      data.token.expires - new Date().getTime() > TOKEN_RENEW_HARD) {
    this.handleNewToken_(data.token.value, data.token.expires);
  }
};

API.prototype.checkExpiredToken_ = function() {
  if (this.token_ == null)
    return;
  // TODO(davidben): Is any of this complexity reeaaaally necessary?
  // With the tokens lasting that long, it seems this is more helpful
  // for just refreshing zephyr credentials slightly more frequently.
  var remaining = this.token_.expires - new Date().getTime();
  if (remaining < TOKEN_RENEW_SOFT) {
    this.refreshAuthToken_({interactive: false}, {
      nonModal: remaining > TOKEN_RENEW_HARD
    });
  }
};

// For debug purposes.
API.prototype.expireTokenSoft = function() {
  if (this.token_ == null)
    throw "No token";
  this.token_.expires = new Date().getTime() + TOKEN_RENEW_SOFT / 2;
};
API.prototype.expireTokenHard = function() {
  if (this.token_ == null)
    throw "No token";
  this.token_.expires = new Date().getTime();
};

API.prototype.refreshAuthToken_ = function(opts, data) {
  // Refresh ticket regardless of whether we have a pending request or
  // not. Previous one might not have been interactive, etc.
  this.ticketManager_.refreshTickets(opts, data);

  if (this.tokenPending_)
    return;
  this.tokenPending_ = true;
  this.ticketManager_.getTicket("server").then(function(ticket) {
    // TODO(davidben): Do we need to negotiate anything interesting?
    // Mutual auth could be useful but only with channel-binding and
    // only in a non-browser environment.
    var context = new gss.Context(this.peer_, gss.KRB5_MECHANISM, ticket, { });
    var gssToken = context.initSecContext(null);
    if (!context.isEstablished())
      throw "Context not established after one message!";

    // TODO(davidben): On auth error, reject the ticket and wait for a
    // new one? And on other errors, some sort of exponential back-off
    // I guess.
    var principal = ticket.client.toString();
    return corsRequest("POST", this.urlBase_ + "/v1/auth", {
      // Only used by fake auth mode.
      principal: principal,
      // Actual auth token.
      token: arrayutils.toBase64(gssToken),
      // TODO(davidben): Only do this for the initial one?
      createUser: true
    }).then(function(json) {
      this.tokenPending_ = false;
      var resp = JSON.parse(json);
      if (this.storageManager_.saveToken(principal,
                                         resp.authToken, resp.expires)) {
        this.handleNewToken_(resp.authToken, resp.expires);
      }
    }.bind(this));
  }.bind(this)).then(null, function(err) {
    this.tokenPending_ = false;
    // TODO(davidben): Error-handling!
    throw err;
  }.bind(this));
};

API.prototype.badToken_ = function(token) {
  if (window.console && console.log)
    console.log("Bad token!");
  if (this.token_ && this.token_.value == token) {
    this.token_ = null;
  }
};

API.prototype.getAuthToken_ = function(interactive, refreshData) {
  if (this.token_ &&
      this.token_.expires - new Date().getTime() > TOKEN_RENEW_HARD) {
    return Q(this.token_.value);
  } else {
    this.refreshAuthToken_({interactive: interactive}, refreshData);
    return this.tokenDeferred_.promise;
  }
};

API.prototype.request = function(method, path, params, data, opts, isRetry) {
  opts = opts || { };
  var tokenPromise = this.getAuthToken_(opts.interactive, opts.refreshData);
  var credsPromise;
  if (opts.withZephyr) {
    this.ticketManager_.refreshTickets({interactive: opts.interactive},
                                       opts.refreshData);
    credsPromise = this.ticketManager_.getTicket("zephyr");
  } else {
    credsPromise = Q();
  }
  params = Q(params); data = Q(data);
  return Q.all([tokenPromise, credsPromise, params, data]).then(function(ret) {
    var token = ret[0], credentials = ret[1], params = ret[2], data = ret[3];
    var url =
      this.urlBase_ + path + "?access_token=" + encodeURIComponent(token);
    if (method != "GET")
      url += "&clientId=" + encodeURIComponent(this.clientId_);
    for (var key in params) {
      url += "&" + key + "=" + encodeURIComponent(params[key]);
    }
    if (opts.withZephyr) {
      data.credentials = credentials.toDict();
    }
    return corsRequest(method, url, data).then(function(responseText) {
      return JSON.parse(responseText);
    }, function(err) {
      // 401 means we had a bad token (it may have expired). Refresh it.
      if (err instanceof HttpError && err.status == 401) {
        this.badToken_(token);
        // Retry the request after we get a new one. Only retry it
        // once though.
        if (!isRetry)
          return this.request(method, path, params, data, false, true);
      }
      throw err;
    }.bind(this));
  }.bind(this));
};

API.prototype.get = function(path, params, opts) {
  return this.request("GET", path, params, undefined, opts);
};

API.prototype.post = function(path, data, opts) {
  return this.request("POST", path, {}, data, opts);
};

API.prototype.checkInnerDemon_ = function() {
  this.get("/v1/zephyrcreds").then(function(result) {
    if (!result.needsRefresh)
      return;

    return this.post("/v1/zephyrcreds", {}, {
      withZephyr: true,
      refreshData: {
        nonModal: true,
        innerDemon: true
      }
    });
  }.bind(this)).then(null, function(err) {
    // TODO(davidben): Emit an error event or something. Also in other places.
    if (window.console && console.error)
      console.error("Error checking zephyr creds", err);
  }.bind(this)).then(function() {
    window.setTimeout(this.checkInnerDemon_.bind(this),
                      INNER_DEMON_CHECK_TIMER);
  }.bind(this)).done();
}

API.prototype.socket = function() {
  return this.socket_;
};

API.prototype.allocateTailId = function() {
  return this.nextTailId_++;
};

API.prototype.tryConnectSocket_ = function() {
  if (this.socket_ || this.socketPending_)
    return;

  this.socketPending_ = true;
  this.getAuthToken_(false).then(function(token) {
    var socket = new RoostSocket(new SockJS(this.urlBase_ + "/v1/socket"));
    socket.sockJS().addEventListener("open", function() {
      socket.send({
        type: "auth",
        clientId: this.clientId_,
        token: token,
      });
    }.bind(this));

    var connected = false;
    var onReady = function() {
      socket.removeEventListener("ready", onReady);
      connected = true;
      this.socketPending_ = false;
      this.socket_ = socket;
      // Reset reconnect state.
      this.reconnectDelay_ = RECONNECT_DELAY;
      this.reconnectTries_ = RECONNECT_TRIES;

      this.dispatchEvent({type: "connect"});
    }.bind(this);
    socket.addEventListener("ready", onReady);

    var onClose = function(ev) {
      socket.sockJS().removeEventListener("close", onClose);
      if (window.console && console.log)
        console.log("Disconnected", ev);
      if (connected) {
        this.dispatchEvent({type: "disconnect"});
        this.socket_ = null;

        setTimeout(this.tryConnectSocket_.bind(this), this.reconnectDelay_);
      } else {
        this.socketPending_ = false;
        if (ev.code == 4003)
          this.badToken_(token);
        // Reconnect with exponential back-off.
        this.reconnectDelay_ *= 2;
        if (this.reconnectTries_-- > 0) {
          setTimeout(this.tryConnectSocket_.bind(this), this.reconnectDelay_);
        }
      }
    }.bind(this);
    socket.sockJS().addEventListener("close", onClose);
  }.bind(this), function(err) {
    // Failure to get auth token... should this also reconnect?
    this.socketPending_ = false;
    throw err;
  }.bind(this)).done();
};
