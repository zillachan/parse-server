const Config = require('./Config');
const Auth = require('./Auth');
const RESTController = require('parse/lib/node/RESTController');
const logger = require('./logger').logger;

export function routeRESTRequest(router, method, path, request, fallback) {

  // Use the router to figure out what handler to use
  var match = router.match(method, path);
  if (!match) {
    //console.log('cannot route ' + method + ' ' + path);
    if (fallback) {
      return fallback();
    }
    throw new Parse.Error(
      Parse.Error.INVALID_JSON,
      'cannot route ' + method + ' ' + path);
  }
  request.params = match.params;
  return match.handler(request);
}

export function DirectRESTController(applicationId, router) {
  return  {
    request: function(method, path, data = {}, options = {}) {
      let args = arguments;
      if (path == 'batch') {
        return RESTController.request.apply(null, arguments);
      }

      let config = new Config(applicationId);
      if (path.indexOf(config.mountPath) === 0) {
        path = path.slice(config.mountPath.length, path.length);
      }
      if (path[0] == "/") {
        path = path.slice(1, path.length);
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
      return new Parse.Promise((resolve, reject) => {
        getAuth(options, config).then((auth) => {
          return routeRESTRequest(router, method, '/'+path, {
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
          //logger.verbose(method, path, response.status,  data, options);
          //logger.verbose("|>", response.response);
          return resolve(response.response, response.status, response);
        }, (error) => {
          //logger.verbose(method, path, data, options);
          //logger.verbose("|>", error);
          return reject(error);
        })
      })
      
    },
    ajax: function() {
      return RESTController.ajax.apply(null, arguments);
    }
  };
};
