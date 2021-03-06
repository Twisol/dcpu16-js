(function (root) {
"use strict";

var CPU = (typeof require === 'undefined') ? root.DCPU16.CPU : require("./cpu.js");
var OPCODES = CPU.OPCODES;
var REGISTER_NAMES = CPU.REGISTER_NAMES;

function isWhitespace(character) {
    return ['\r', '\t', ' ', ','].indexOf(character) !== -1;
}

function getToken(string) {
    return string.split(/[\s,;]/)[0];
}

function Assembler(cpu) {
    this.cpu = cpu;
    this.instructionMap = [];
    this.addressMap = [];
    this.instruction = 0;
}

Assembler.prototype = {
    // Parser functions must take a string as input,
    // and return the remainder of the string and any results.

    readLabels: function(line) {
        var labels = [];

        var i;
        for (i = 0; i < line.length; ++i) {
            var c = line.charAt(i);
            if (isWhitespace(c)) continue;

            // stop at the first non-label item
            if (c !== ":") break;

            labels.push(getToken(line.substr(i+1)).toLowerCase());
            i += getToken(line.substr(i)).length;
        }

        return [line.substr(i), labels];
    },
    readInstruction: function(line) {
        var op = '';
        var args = [];

        var end = line.indexOf('\n');
        if(end === -1) end = line.length;

        var i;
        for(i = 0; i < end; i++) {
            var c = line.charAt(i);
            if(isWhitespace(c)) continue;
            if(c === ';' || c === '\n') break;

            if(!op) {
            // opcode
                op = getToken(line.substr(i));
                i += op.length - 1;
            } else {
            // argument
                var arg;

                // string literal
                if(line.charAt(i) === '"') {
                    for(var j = i + 1; j < end; j++) {
                        if(line.charAt(j) === '"' && (line.charAt(j - 1) !== '\\' || line.charAt(j - 2) === '\\')) {
                            arg = line.substring(i, j + 1);
                            break;
                        }
                    }
                    if(!arg)
                        throw new Error('Unterminated string literal');
                // address
                } else if(line.charAt(i) === '[') {
                    for(var j = i + 1; j < end; j++) {
                        if(line.charAt(j) === ']') {
                            arg = line.substring(i, j + 1);
                            break;
                        }
                    }
                    if(!arg)
                        throw new Error('Unclosed pointer brackets');
                // other
                } else {
                    arg = getToken(line.substr(i));

                    if(arg.indexOf(':') !== -1) {
                        throw new Error('Illegal symbol ":"');
                    }
                }

                if(OPCODES[op] !== null
                    && ((OPCODES[op] > 0xff && args.length > 1) || (OPCODES[op] < 0xff && args.length > 2))) {
                    throw new Error('Invalid amount of arguments for op ' + op);
                }

                i += arg.length - 1;
                if(arg.length > 0)
                    args.push(arg);
            }
        }

        return [
            line.substr(i),
            (op) ? [op].concat(args) : null
        ];
    },
    readComment: function(line) {
        var semicolon = line.indexOf(";");
        var newline = line.indexOf("\n")
        if (newline === -1) newline = line.length;

        var rest = line.substr(newline+1);
        if (semicolon < newline) {
            return [rest, line.substr(semicolon+1, newline-1)];
        } else {
            return [rest, null];
        }
    },
    serialize: function(code) {
        var instructions = [];
        var subroutines = {};

        var lineNumber = 1;

        var step = [code, null];
        var labels, instruction, comment;
        while (step[0] !== "") {
            // this feels so much like a monad it's not even funny
            step = this.readLabels(step[0]);
            labels = step[1];
            step = this.readInstruction(step[0]);
            instruction = step[1];
            step = this.readComment(step[0]);
            comment = step[1];

            for (var i = 0; i < labels.length; ++i)
                subroutines[labels[i]] = instructions.length;

            if (instruction) {
                instructions.push(instruction);
                this.instructionMap.push(lineNumber);
            }

            lineNumber += 1;
        }

        return {
            instructions: instructions,
            subroutines: subroutines
        };
    },
    compile: function(code) {
        this.instruction = 0;
        var serialized = this.serialize(code);

        var i, j, address = 0;
        var subroutineQueue = [];
        var cpu = this.cpu, value, words, operand, line, op, args, sr, c;

        function pack(value) {
            if(OPCODES[op] !== null)
                words[0] += value << (4 + operand * 6);
        }

        function parse(arg) {
            arg = arg.replace('\t', '').replace('\n', '');

            var pointer = false, offset;
            if(arg.charAt(0) === '[' && arg.charAt(arg.length - 1) === ']') {
                pointer = true;
                arg = arg.substring(1, arg.length - 1);
            }

            //string literal
            if(arg.charAt(0) === '"' && arg.charAt(arg.length - 1) === '"') {
                arg = arg.substr(1, arg.length - 2);
                for( j = 0; j < arg.length; j++) {
                    var character;
                    if(arg.charAt(j) === '\\') {
                        switch(arg.charAt(j+1)) {
                            case 'n':
                                character = 10;
                                break;
                            case 'r':
                                character = 13;
                                break;
                            case 'a':
                                character = 7;
                                break;
                            case '\\':
                                character = 92;
                                break;
                            case '"':
                                character = 34;
                                break;
                            case '0':
                                character = 0;
                                break;
                            default:
                                throw new Error('Unrecognized string escape (\\' + arg.charAt(j + 1) + ')');
                        }
                        j++;
                    } else {
                        character = arg.charCodeAt(j);
                    }

                    if(OPCODES[op] !== null)
                        pack(0x1f);
                    words.push(character);
                }
            }

            //offset + register/register + offset
            else if(pointer && arg.split('+').length === 2) {
                var typeError = new Error('Invalid offset pointer, must have 1 literal/subroutine and 1 register');

                var register, offset, split = arg.replace(/ +?/g,'').split('+');
                for(var i = 0; i < 2; i++) {
                    if(parseInt(split[i]) || parseInt(split[i]) === 0) {
                        if(!offset) {
                            offset = parseInt(split[i]);
                        } else {
                            throw typeError;
                        }

                        if(offset < 0 || offset > 0xffff) {
                            throw new Error('Invalid offset [' + arg + '], must be between 0 and 0xffff');
                        }

                        words.push(offset);
                    } else if(REGISTER_NAMES.indexOf(split[i].toLowerCase()) !== -1) {
                        if(!register) {
                            register = split[i].toLowerCase();
                        } else {
                            throw typeError;
                        }
                    } else {
                        if(!offset) {
                            subroutineQueue.push({
                                id: split[i],
                                address: address + words.length
                            });
                            offset = 0;
                            words.push(0x0000);
                        } else {
                            throw typeError;
                        }
                    }
                }

                switch (register) {
                    case 'a':
                        pack(0x10);
                        break;
                    case 'b':
                        pack(0x11);
                        break;
                    case 'c':
                        pack(0x12);
                        break;
                    case 'x':
                        pack(0x13);
                        break;
                    case 'y':
                        pack(0x14);
                        break;
                    case 'z':
                        pack(0x15);
                        break;
                    case 'i':
                        pack(0x16);
                        break;
                    case 'j':
                        pack(0x17);
                        break;
                    default: throw typeError;
                }
            }

            //literals/pointers
            else if(parseInt(arg) || parseInt(arg) === 0) {
                value = parseInt(arg);

                if(value < 0 || value > 0xffff) {
                    throw new Error('Invalid value 0x' + value.toString(16) + ', must be between 0 and 0xffff');
                }

                //0x20-0x3f: literal value 0x00-0x1f (literal)
                if(!pointer && value <= 0x1f && OPCODES[op] !== null) {
                    pack(value + 0x20);
                } else {
                    //0x1e: [next word]
                    if(pointer) {
                        pack(0x1e);
                    } else {
                        //0x1f: next word (literal)
                        pack(0x1f);
                    }

                    words.push(value);
                }
            }

            //other tokens
            else {
                switch (arg.toLowerCase()) {
                    //0x00-0x07: register (A, B, C, X, Y, Z, I or J, in
                    // that
                    // order)
                    //0x08-0x0f: [register]
                    case 'a':
                        if(!pointer) {
                            pack(0x00);
                        } else {
                            pack(0x08);
                        }
                        break;
                    case 'b':
                        if(!pointer) {
                            pack(0x01);
                        } else {
                            pack(0x09);
                        }
                        break;
                    case 'c':
                        if(!pointer) {
                            pack(0x02);
                        } else {
                            pack(0x0a);
                        }
                        break;
                    case 'x':
                        if(!pointer) {
                            pack(0x03);
                        } else {
                            pack(0x0b);
                        }
                        break;
                    case 'y':
                        if(!pointer) {
                            pack(0x04);
                        } else {
                            pack(0x0c);
                        }
                        break;
                    case 'z':
                        if(!pointer) {
                            pack(0x05);
                        } else {
                            pack(0x0d);
                        }
                        break;
                    case 'i':
                        if(!pointer) {
                            pack(0x06);
                        } else {
                            pack(0x0e);
                        }
                        break;
                    case 'j':
                        if(!pointer) {
                            pack(0x07);
                        } else {
                            pack(0x0f);
                        }
                        break;

                    //0x18: POP / [SP++]
                    case 'sp++':
                    case 'pop':
                        pack(0x18);
                        break;

                    //0x19: PEEK / [SP]
                    case 'sp':
                        if(pointer) {
                            pack(0x19);
                        } else {
                            pack(0x1b);
                        }
                        break;
                    case 'peek':
                        pack(0x19);
                        break;

                    //0x1a: PUSH / [--SP]
                    case '--sp':
                    case 'push':
                        pack(0x1a);
                        break;

                    //0x1c: PC
                    case 'pc':
                        pack(0x1c);
                        break;

                    //0x1d: O
                    case 'o':
                        pack(0x1d);
                        break;

                    default:
                        if(arg) {
                            if(pointer) pack(0x1e);
                            else pack(0x1f);
                            subroutineQueue.push({
                                id: arg,
                                address: address + words.length
                            });
                            words.push(0x0000);
                        }
                        break;
                }
            }
            operand++;
        }

        for(this.instruction = 0; this.instruction < serialized.instructions.length; this.instruction++) {
            var op = serialized.instructions[this.instruction][0].toUpperCase(), args = serialized.instructions[this.instruction].slice(1);
            if( typeof op !== 'undefined') {
                if( typeof OPCODES[op] !== 'undefined') {
                    if(OPCODES[op] !== null)
                        words = [OPCODES[op]];
                    else
                        words = [];
                    operand = 0;

                    if(words[0] > 0xf) {
                        operand++;
                    }

                    for( i = 0; i < args.length; i++) {
                        parse(args[i]);
                    }

                    var preAddr = address;
                    for( j = 0; j < words.length; j++) {
                        cpu.mem[address++] = words[j];
                    }
                    var postAddr = address;

                    for( i = preAddr; i <= postAddr; i++) {
                        this.addressMap[i] = this.instruction;
                    }
                } else {
                    throw new Error('Invalid opcode (' + op + ')');
                }
            }
        }

        for( i = 0; i < subroutineQueue.length; i++) {
            sr = subroutineQueue[i];
            if( typeof serialized.subroutines[sr.id.toLowerCase()] === 'number') {
                var value = this.addressMap.indexOf(serialized.subroutines[sr.id.toLowerCase()]);
                if(value === -1) value = address;
                cpu.mem[sr.address] = value;
            } else {
                throw new Error('Label ' + sr.id + ' was not defined (address ' + sr.address + ')');
            }
        }
    }
};

if (typeof module === 'undefined') {
    // we're in the browser
    (root.DCPU16 = (root.DCPU16 || {})).Assembler = Assembler;
} else {
    module.exports = Assembler;
}

})(this);
