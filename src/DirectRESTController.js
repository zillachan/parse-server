const Config = require('./Config');
const Auth = require('./Auth');
const RESTController = require('parse/lib/node/RESTController');
const URL = require('url');
import {
  logRequest,
  logResponse
} from './SensitiveLogger';

export function routeRESTRequest(router, method, path, request, fallback) {

  // Use the router to figure out what handler to use
  var match = router.match(method, path);
  if (!match) {
    if (fallback) {
      return fallback();
    }
    throw new Parse.Error(
      Parse.Error.INVALID_JSON,
      'cannot route ' + method + ' ' + path);
  }
  request.params = match.params;
  return new Promise((resolve, reject) => {
    match.handler(request).then(resolve, reject);
  });
}

export function DirectRESTController(applicationId, router) {
  function handleRequest(method, path, data = {}, options = {}) {
      let args = arguments;
      if (path == 'batch') {
        let promises = data.requests.map((request) => {
          return handleRequest(request.method, request.path, request.body, options).then((response) => {
            return Parse.Promise.as({success: response});
          }, (error) => {
            return Parse.Promise.as({error: {code: error.code, error: error.message}});
          });
        });
        return Parse.Promise.all(promises);
      }

      let config = new Config(applicationId);
      let serverURL = URL.parse(config.serverURL);
      if (path.indexOf(serverURL.path) === 0) {
        path = path.slice(serverURL.path.length, path.length);
      }

      if (path[0] !== "/") {
        path = "/" + path;
      }

      function getSessionToken(options) {
        var userController = Parse.CoreManager.getUserController();
        if (options && typeof options.sessionToken === 'string') {
          return Parse.Promise.as(options.sessionToken);
        } else if (userController) {
          return userController.currentUserAsync().then((user) => {
            if (user) {
              let sessionToken = user.getSessionToken();
              return Parse.Promise.as(sessionToken);
            }
            return Parse.Promise.as(null);
          });
        }
        return Parse.Promise.as(null);
      }

      function getAuth(options, config) {
        if (options.useMasterKey) {
           return Parse.Promise.as(new Auth.Auth({config, isMaster: true }));
        }
        return getSessionToken(options).then((sessionToken) => {
          if (sessionToken) {
            options.sessionToken = sessionToken;
            return Auth.getAuthForSessionToken({
              config,
              sessionToken: sessionToken
            });
          } else {
            return Parse.Promise.as(new Auth.Auth({ config }));
          }
        })
      }

      let query;
      if (method === 'GET') {
        query = data;
      }
      let forwardResponse = false;
      logRequest(config.serverURL+path, method, data, {});
      return new Parse.Promise((resolve, reject) => {
        getAuth(options, config).then((auth) => {
          return routeRESTRequest(router, method, path, {
            body: data,
            config,
            auth,
            info: {
              applicationId: applicationId,
              sessionToken: options.sessionToken
            },
            query
          }, function() {
            forwardResponse = true;
            return RESTController.request.apply(null, args);
          });
        }).then((response) => {
          if (forwardResponse) {
            return resolve(response);
          }
          logResponse(config.serverURL+path, method, response.response, {});
          return resolve(response.response, response.status, response);
        }, (error) => {
          return reject(error);
        })
      })
      
    };

  return  {
    request: handleRequest,
    ajax: function() {
      return RESTController.ajax.apply(null, arguments);
    }
  };
};
