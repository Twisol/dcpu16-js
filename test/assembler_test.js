var CPU = require("../lib/cpu.js");
var Assembler = require("../lib/assembler.js");
var assert = require("assert");

// just for the assembler to target when compiling
var cpu = new CPU();
module.exports = {
    'test Assembler#readLabels': function() {
        var asm = new Assembler(cpu);

        assert.deepEqual(asm.readLabels(":foo :bar"), ["", ["foo", "bar"]]);
        assert.deepEqual(asm.readLabels(":data DAT 1, 2"), ["DAT 1, 2", ["data"]]);

        assert.deepEqual(asm.readLabels("\n:foo"), ["\n:foo", []]);
    },
    'test Assembler#readInstruction': function() {
        var asm = new Assembler(cpu);

        assert.deepEqual(asm.readInstruction("SET A, B"), ["", ["SET", "A", "B"]]);
        assert.deepEqual(asm.readInstruction("JSR 0x1234"), ["", ["JSR", "0x1234"]]);
        assert.deepEqual(asm.readInstruction("DAT 1, 2"), ["", ["DAT", "1", "2"]]);

        assert.deepEqual(asm.readInstruction("BRK;test"), [";test", ["BRK"]]);
        assert.deepEqual(asm.readInstruction("DAT 1, 2;test"), [";test", ["DAT", "1", "2"]]);

        assert.deepEqual(asm.readLabels(";test"), [";test", []]);
    },
    'test Assembler#readComment': function() {
        var asm = new Assembler(cpu);

        assert.deepEqual(asm.readComment(";foo "), ["", "foo "]);

        assert.deepEqual(asm.readComment("\n:foo"), [":foo", ""]);
    },
    'test semicolons in string literals': function() {
        var asm = new Assembler(cpu);

        assert.deepEqual(asm.readInstruction('DAT "foo;bar"'), ["", ['DAT', '"foo;bar"']]);
    },
    'test Assembler#serialize': function() {
        var asm, ast;

        asm = new Assembler(cpu);
        ast = asm.serialize(":test DAT 1 ;comment");
        assert.deepEqual(ast, {
            instructions: [["DAT", "1"]],
            subroutines: {"test": 0}
        });

        asm = new Assembler(cpu);
        ast = asm.serialize("DAT 1\r\n:test SET A, B ;comment");
        assert.deepEqual(ast, {
            instructions: [["DAT", "1"], ["SET", "A", "B"]],
            subroutines: {"test": 1}
        });
    }
};
