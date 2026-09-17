const XLSX = require(path_require('xlsx'));
function path_require(x){return require.resolve(x, {paths:[require('path').join(__dirname,'..','..','backend','node_modules')]});}
