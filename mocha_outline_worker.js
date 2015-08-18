define(function(require, exports, module) {

var parser = require("treehugger/js/parse");
var traverse = require("treehugger/traverse");
var baseLanguageHandler = require("plugins/c9.ide.language/base_handler");
// var parser = require("plugins/c9.ide.language/parse");

var handler = module.exports = Object.create(baseLanguageHandler);

handler.init = function() {
    // Create a new event handler. 
    handler.sender.on("mocha_outline", function(e) {
        // code = code.replace(/^(#!.*\n)/, "//$1");
        var ast = parser.parse(e.data.code);
        
        handler.sender.emit("mocha_outline_result", {
            id: e.data.id, // Some unique id for this request
            result: getTestCases(ast)
        });
    });
};

handler.handlesLanguage = function() {
    return false;
};

function getTestCases(ast) {
    var items = [];
    
    // Traverse the AST with some pattern matching
    // for debugging, do ast.toString() or node.toString()
    ast.traverseTopDown( 
        'Call(Var("before"), _)', function(b, node) {
            items.push({
                label: "before all",
                type: "prepare",
                pos: node.getPos()
            });
        },
        'Call(Var("beforeEach"), _)', function(b, node) {
            items.push({
                label: "before each",
                type: "prepare",
                pos: node.getPos()
            });
        },
        'Call(Var("after"), _)', function(b, node) {
            items.push({
                label: "before all",
                type: "prepare",
                pos: node.getPos()
            });
        },
        'Call(Var("afterEach"), _)', function(b, node) {
            items.push({
                label: "before each",
                type: "prepare",
                pos: node.getPos()
            });
        },
        'Call(Var("it"), [String(description), _])', function(b, node) {
            items.push({
                label: b.description.value,
                kind: "it",
                type: "test",
                selpos: b.description.getPos(),
                pos: node.getPos()
            });
        },
        'Call(Var("describe"), [String(description), body])', function(b, node) {
            items.push({
                label: b.description.value,
                items: getTestCases(b.body),
                type: "describe",
                isOpen: true,
                selpos: b.description.getPos(),
                pos: node.getPos()
            });
            return node;
        }
    );
    
    return items;
}

});