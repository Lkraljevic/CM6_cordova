(function (factory) {
    typeof define === 'function' && define.amd ? define(factory) :
    factory();
}(function () { 'use strict';

    /*! *****************************************************************************
    Copyright (c) Microsoft Corporation. All rights reserved.
    Licensed under the Apache License, Version 2.0 (the "License"); you may not use
    this file except in compliance with the License. You may obtain a copy of the
    License at http://www.apache.org/licenses/LICENSE-2.0

    THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
    WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
    MERCHANTABLITY OR NON-INFRINGEMENT.

    See the Apache Version 2.0 License for specific language governing permissions
    and limitations under the License.
    ***************************************************************************** */
    /* global Reflect, Promise */

    var extendStatics = function(d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };

    function __extends(d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    }

    var extendingChars = /[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u065e\u0670\u06d6-\u06dc\u06de-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u0b82\u0bbe\u0bc0\u0bcd\u0bd7\u0d3e\u0d41-\u0d44\u0d4d\u0d57\u0d62\u0d63\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u180b-\u180d\u18a9\u200c\u200d]/;
    try {
        extendingChars = new RegExp("\\p{Grapheme_Extend}", "u");
    }
    catch (_) { }
    function isExtendingChar(ch) {
        var code = ch.charCodeAt(0);
        return code >= 768 && (code >= 0xdc00 && code < 0xe000 || extendingChars.test(ch));
    }
    var nonASCIISingleCaseWordChar = /[\u00df\u0587\u0590-\u05f4\u0600-\u06ff\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/;
    var wordChar;
    try {
        wordChar = new RegExp("[\\p{Alphabetic}_]", "u");
    }
    catch (_) { }
    // FIXME this doesn't work for astral chars yet (need different calling convention)
    function isWordCharBasic(ch) {
        if (wordChar)
            return wordChar.test(ch);
        return /\w/.test(ch) || ch > "\x80" &&
            (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch));
    }
    function isWordChar(ch, wordChars) {
        if (!wordChars)
            return isWordCharBasic(ch);
        if (wordChars.source.indexOf("\\w") > -1 && isWordCharBasic(ch))
            return true;
        return wordChars.test(ch);
    }
    function charType(ch, wordChars) {
        return /\s/.test(ch) ? 1 /* SPACE */ : isWordChar(ch, wordChars) ? 0 /* WORD */ : 2 /* OTHER */;
    }

    function countColumn(string, n, tabSize) {
        for (var i = 0; i < string.length; i++) {
            var code = string.charCodeAt(i);
            if (code == 9)
                n += tabSize - (n % tabSize);
            else if (code < 768 || !isExtendingChar(string.charAt(i)))
                n++;
        }
        return n;
    }
    function findColumn(string, n, col, tabSize) {
        for (var i = 0; i < string.length; i++) {
            var code = string.charCodeAt(i);
            if (code >= 768 && isExtendingChar(string.charAt(i)))
                continue;
            if (n >= col)
                return { offset: i, leftOver: 0 };
            n += code == 9 ? tabSize - (n % tabSize) : 1;
        }
        return { offset: string.length, leftOver: col - n };
    }

    // The base size of a leaf node
    var BASE_LEAF = 512;
    // The max size of a leaf node
    var MAX_LEAF = BASE_LEAF << 1;
    // The desired amount of branches per node, as an exponent of 2 (so 3
    // means 8 branches)
    var TARGET_BRANCH_SHIFT = 3;
    // Note line numbers are 1-based
    var Text = /** @class */ (function () {
        // @internal
        function Text() {
        }
        Text.prototype.lineAt = function (pos) {
            if (pos < 0 || pos > this.length)
                throw new RangeError("Invalid position " + pos + " in document of length " + this.length);
            for (var i = 0; i < lineCache.length; i += 2) {
                if (lineCache[i] != this)
                    continue;
                var line = lineCache[i + 1];
                if (line.start <= pos && line.end >= pos)
                    return line;
            }
            return cacheLine(this, this.lineInner(pos, false, 1, 0).finish(this));
        };
        Text.prototype.line = function (n) {
            if (n < 1 || n > this.lines)
                throw new RangeError("Invalid line number ${n} in ${this.lines}-line document");
            for (var i = 0; i < lineCache.length; i += 2) {
                if (lineCache[i] != this)
                    continue;
                var line = lineCache[i + 1];
                if (line.number == n)
                    return line;
            }
            return cacheLine(this, this.lineInner(n, true, 1, 0).finish(this));
        };
        Text.prototype.replace = function (from, to, text) {
            if (text.length == 0)
                throw new RangeError("An inserted range must have at least one line");
            return this.replaceInner(from, to, text, textLength(text));
        };
        Text.prototype.sliceLines = function (from, to) {
            if (to === void 0) { to = this.length; }
            return this.sliceTo(from, to, [""]);
        };
        Text.prototype.slice = function (from, to, lineSeparator) {
            return joinLines(this.sliceLines(from, to), lineSeparator);
        };
        Text.prototype.eq = function (other) { return this == other || eqContent(this, other); };
        Text.prototype.iter = function (dir) {
            if (dir === void 0) { dir = 1; }
            return new RawTextCursor(this, dir);
        };
        Text.prototype.iterRange = function (from, to) {
            if (to === void 0) { to = this.length; }
            return new PartialTextCursor(this, from, to);
        };
        Text.prototype.iterLines = function (from) {
            if (from === void 0) { from = 0; }
            return new LineCursor(this, from);
        };
        Text.prototype.toString = function () { return this.slice(0, this.length); };
        Text.of = function (text, lineSeparator) {
            if (typeof text == "string")
                text = splitLines(text, lineSeparator);
            else if (text.length == 0)
                throw new RangeError("A document must have at least one line");
            var length = textLength(text);
            return length < MAX_LEAF ? new TextLeaf(text, length) : TextNode.from(TextLeaf.split(text, []), length);
        };
        return Text;
    }());
    var lineCache = [], lineCachePos = -2, lineCacheSize = 12;
    function cacheLine(text, line) {
        lineCachePos = (lineCachePos + 2) % lineCacheSize;
        lineCache[lineCachePos] = text;
        lineCache[lineCachePos + 1] = line;
        return line;
    }
    function splitLines(text, lineSeparator) {
        if (lineSeparator === void 0) { lineSeparator = DEFAULT_SPLIT; }
        return text.split(lineSeparator);
    }
    function joinLines(text, lineSeparator) {
        if (lineSeparator === void 0) { lineSeparator = "\n"; }
        return text.join(lineSeparator);
    }
    var DEFAULT_SPLIT = /\r\n?|\n/;
    var TextLeaf = /** @class */ (function (_super) {
        __extends(TextLeaf, _super);
        function TextLeaf(text, length) {
            if (length === void 0) { length = textLength(text); }
            var _this = _super.call(this) || this;
            _this.text = text;
            _this.length = length;
            return _this;
        }
        Object.defineProperty(TextLeaf.prototype, "lines", {
            get: function () { return this.text.length; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(TextLeaf.prototype, "children", {
            get: function () { return null; },
            enumerable: true,
            configurable: true
        });
        TextLeaf.prototype.replaceInner = function (from, to, text, length) {
            return Text.of(appendText(this.text, appendText(text, sliceText(this.text, 0, from)), to));
        };
        TextLeaf.prototype.sliceTo = function (from, to, target) {
            if (to === void 0) { to = this.length; }
            return appendText(this.text, target, from, to);
        };
        TextLeaf.prototype.lineInner = function (target, isLine, line, offset) {
            for (var i = 0;; i++) {
                var string = this.text[i], end = offset + string.length;
                if ((isLine ? line : end) >= target)
                    return new Line(offset, end, line, string);
                offset = end + 1;
                line++;
            }
        };
        TextLeaf.prototype.decomposeStart = function (to, target) {
            target.push(new TextLeaf(sliceText(this.text, 0, to), to));
        };
        TextLeaf.prototype.decomposeEnd = function (from, target) {
            target.push(new TextLeaf(sliceText(this.text, from), this.length - from));
        };
        TextLeaf.prototype.lastLineLength = function () { return this.text[this.text.length - 1].length; };
        TextLeaf.prototype.firstLineLength = function () { return this.text[0].length; };
        TextLeaf.split = function (text, target) {
            var part = [], length = -1;
            for (var _i = 0, text_1 = text; _i < text_1.length; _i++) {
                var line = text_1[_i];
                for (;;) {
                    var newLength = length + line.length + 1;
                    if (newLength < BASE_LEAF) {
                        length = newLength;
                        part.push(line);
                        break;
                    }
                    var cut = BASE_LEAF - length - 1, after_1 = line.charCodeAt(cut);
                    if (after_1 >= 0xdc00 && after_1 < 0xe000)
                        cut++;
                    part.push(line.slice(0, cut));
                    target.push(new TextLeaf(part, BASE_LEAF));
                    line = line.slice(cut);
                    length = -1;
                    part = [];
                }
            }
            if (length != -1)
                target.push(new TextLeaf(part, length));
            return target;
        };
        return TextLeaf;
    }(Text));
    var TextNode = /** @class */ (function (_super) {
        __extends(TextNode, _super);
        function TextNode(children, length) {
            var _this = _super.call(this) || this;
            _this.children = children;
            _this.length = length;
            _this.lines = 1;
            for (var _i = 0, children_1 = children; _i < children_1.length; _i++) {
                var child = children_1[_i];
                _this.lines += child.lines - 1;
            }
            return _this;
        }
        TextNode.prototype.replaceInner = function (from, to, text, length) {
            var lengthDiff = length - (to - from), newLength = this.length + lengthDiff;
            if (newLength <= BASE_LEAF)
                return new TextLeaf(appendText(this.sliceLines(to), appendText(text, this.sliceTo(0, from, [""]))), newLength);
            var children;
            for (var i = 0, pos = 0; i < this.children.length; i++) {
                var child = this.children[i], end = pos + child.length;
                if (from >= pos && to <= end &&
                    (lengthDiff > 0
                        ? child.length + lengthDiff < Math.max(newLength >> (TARGET_BRANCH_SHIFT - 1), MAX_LEAF)
                        : child.length + lengthDiff > newLength >> (TARGET_BRANCH_SHIFT + 1))) {
                    // Fast path: if the change only affects one child and the
                    // child's size remains in the acceptable range, only update
                    // that child
                    children = this.children.slice();
                    children[i] = child.replace(from - pos, to - pos, text);
                    return new TextNode(children, newLength);
                }
                else if (end >= from) {
                    // Otherwise, we must build up a new array of children
                    if (children == null)
                        children = this.children.slice(0, i);
                    if (pos < from) {
                        if (end == from)
                            children.push(child);
                        else
                            child.decomposeStart(from - pos, children);
                    }
                    if (pos <= from && end >= from)
                        TextLeaf.split(text, children);
                    if (pos >= to)
                        children.push(child);
                    else if (end > to)
                        child.decomposeEnd(to - pos, children);
                }
                pos = end;
            }
            return children ? TextNode.from(children, newLength) : this;
        };
        TextNode.prototype.sliceTo = function (from, to, target) {
            var pos = 0;
            for (var _i = 0, _a = this.children; _i < _a.length; _i++) {
                var child = _a[_i];
                var end = pos + child.length;
                if (to > pos && from < end)
                    child.sliceTo(Math.max(0, from - pos), Math.min(child.length, to - pos), target);
                pos = end;
            }
            return target;
        };
        TextNode.prototype.lineInner = function (target, isLine, line, offset) {
            for (var i = 0;; i++) {
                var child = this.children[i], end = offset + child.length, endLine = line + child.lines - 1;
                if ((isLine ? endLine : end) >= target) {
                    var inner = child.lineInner(target, isLine, line, offset), add = void 0;
                    if (inner.start == offset && (add = this.lineLengthTo(i))) {
                        inner.start -= add;
                        inner.content = null;
                    }
                    if (inner.end == end && (add = this.lineLengthFrom(i + 1))) {
                        inner.end += add;
                        inner.content = null;
                    }
                    return inner;
                }
                offset = end;
                line = endLine;
            }
        };
        TextNode.prototype.decomposeStart = function (to, target) {
            for (var i = 0, pos = 0;; i++) {
                var child = this.children[i], end = pos + child.length;
                if (end <= to) {
                    target.push(child);
                }
                else {
                    if (pos < to)
                        child.decomposeStart(to - pos, target);
                    break;
                }
                pos = end;
            }
        };
        TextNode.prototype.decomposeEnd = function (from, target) {
            var pos = 0;
            for (var _i = 0, _a = this.children; _i < _a.length; _i++) {
                var child = _a[_i];
                var end = pos + child.length;
                if (pos >= from)
                    target.push(child);
                else if (end > from && pos < from)
                    child.decomposeEnd(from - pos, target);
                pos = end;
            }
        };
        TextNode.prototype.lineLengthTo = function (to) {
            var length = 0;
            for (var i = to - 1; i >= 0; i--) {
                var child = this.children[i];
                if (child.lines > 1)
                    return length + child.lastLineLength();
                length += child.length;
            }
            return length;
        };
        TextNode.prototype.lastLineLength = function () { return this.lineLengthTo(this.children.length); };
        TextNode.prototype.lineLengthFrom = function (from) {
            var length = 0;
            for (var i = from; i < this.children.length; i++) {
                var child = this.children[i];
                if (child.lines > 1)
                    return length + child.firstLineLength();
                length += child.length;
            }
            return length;
        };
        TextNode.prototype.firstLineLength = function () { return this.lineLengthFrom(0); };
        TextNode.from = function (children, length) {
            if (length < MAX_LEAF) {
                var text = [""];
                for (var _i = 0, children_2 = children; _i < children_2.length; _i++) {
                    var child = children_2[_i];
                    child.sliceTo(0, child.length, text);
                }
                return new TextLeaf(text, length);
            }
            var chunkLength = Math.max(BASE_LEAF, length >> TARGET_BRANCH_SHIFT), maxLength = chunkLength << 1, minLength = chunkLength >> 1;
            var chunked = [], currentLength = 0, currentChunk = [];
            function add(child) {
                var childLength = child.length, last;
                if (childLength > maxLength && child instanceof TextNode) {
                    for (var _i = 0, _a = child.children; _i < _a.length; _i++) {
                        var node = _a[_i];
                        add(node);
                    }
                }
                else if (childLength > minLength && (currentLength > minLength || currentLength == 0)) {
                    flush();
                    chunked.push(child);
                }
                else if (child instanceof TextLeaf && currentLength > 0 &&
                    (last = currentChunk[currentChunk.length - 1]) instanceof TextLeaf &&
                    child.length + last.length <= BASE_LEAF) {
                    currentLength += childLength;
                    currentChunk[currentChunk.length - 1] = new TextLeaf(appendText(child.text, last.text.slice()), child.length + last.length);
                }
                else {
                    if (currentLength + childLength > chunkLength)
                        flush();
                    currentLength += childLength;
                    currentChunk.push(child);
                }
            }
            function flush() {
                if (currentLength == 0)
                    return;
                chunked.push(currentChunk.length == 1 ? currentChunk[0] : TextNode.from(currentChunk, currentLength));
                currentLength = 0;
                currentChunk.length = 0;
            }
            for (var _a = 0, children_3 = children; _a < children_3.length; _a++) {
                var child = children_3[_a];
                add(child);
            }
            flush();
            return chunked.length == 1 ? chunked[0] : new TextNode(chunked, length);
        };
        return TextNode;
    }(Text));
    function textLength(text) {
        var length = -1;
        for (var _i = 0, text_2 = text; _i < text_2.length; _i++) {
            var line = text_2[_i];
            length += line.length + 1;
        }
        return length;
    }
    function appendText(text, target, from, to) {
        if (from === void 0) { from = 0; }
        if (to === void 0) { to = 1e9; }
        for (var pos = 0, i = 0, first = true; i < text.length && pos <= to; i++) {
            var line = text[i], end = pos + line.length;
            if (end >= from) {
                if (end > to)
                    line = line.slice(0, to - pos);
                if (pos < from)
                    line = line.slice(from - pos);
                if (first) {
                    target[target.length - 1] += line;
                    first = false;
                }
                else
                    target.push(line);
            }
            pos = end + 1;
        }
        return target;
    }
    function sliceText(text, from, to) {
        return appendText(text, [""], from, to);
    }
    function eqContent(a, b) {
        if (a.length != b.length || a.lines != b.lines)
            return false;
        var iterA = new RawTextCursor(a), iterB = new RawTextCursor(b);
        for (var offA = 0, offB = 0;;) {
            if (iterA.lineBreak != iterB.lineBreak || iterA.done != iterB.done) {
                return false;
            }
            else if (iterA.done) {
                return true;
            }
            else if (iterA.lineBreak) {
                iterA.next();
                iterB.next();
                offA = offB = 0;
            }
            else {
                var strA = iterA.value.slice(offA), strB = iterB.value.slice(offB);
                if (strA.length == strB.length) {
                    if (strA != strB)
                        return false;
                    iterA.next();
                    iterB.next();
                    offA = offB = 0;
                }
                else if (strA.length > strB.length) {
                    if (strA.slice(0, strB.length) != strB)
                        return false;
                    offA += strB.length;
                    iterB.next();
                    offB = 0;
                }
                else {
                    if (strB.slice(0, strA.length) != strA)
                        return false;
                    offB += strA.length;
                    iterA.next();
                    offA = 0;
                }
            }
        }
    }
    var RawTextCursor = /** @class */ (function () {
        // @internal
        function RawTextCursor(text, dir) {
            if (dir === void 0) { dir = 1; }
            this.dir = dir;
            this.done = false;
            this.lineBreak = false;
            this.value = "";
            this.nodes = [text];
            this.offsets = [dir > 0 ? 0 : text instanceof TextLeaf ? text.text.length : text.children.length];
        }
        RawTextCursor.prototype.next = function (skip) {
            if (skip === void 0) { skip = 0; }
            for (;;) {
                var last = this.nodes.length - 1;
                if (last < 0) {
                    this.done = true;
                    this.value = "";
                    this.lineBreak = false;
                    return this;
                }
                var top_1 = this.nodes[last];
                var offset = this.offsets[last];
                if (top_1 instanceof TextLeaf) {
                    // Internal ofset with lineBreak == false means we have to
                    // count the line break at this position
                    if (offset != (this.dir > 0 ? 0 : top_1.text.length) && !this.lineBreak) {
                        this.lineBreak = true;
                        if (skip == 0) {
                            this.value = "\n";
                            return this;
                        }
                        skip--;
                        continue;
                    }
                    // Otherwise, move to the next string
                    var next = top_1.text[offset - (this.dir < 0 ? 1 : 0)];
                    this.offsets[last] = (offset += this.dir);
                    if (offset == (this.dir > 0 ? top_1.text.length : 0)) {
                        this.nodes.pop();
                        this.offsets.pop();
                    }
                    this.lineBreak = false;
                    if (next.length > skip) {
                        this.value = skip == 0 ? next : this.dir > 0 ? next.slice(skip) : next.slice(0, next.length - skip);
                        return this;
                    }
                    skip -= next.length;
                }
                else if (offset == (this.dir > 0 ? top_1.children.length : 0)) {
                    this.nodes.pop();
                    this.offsets.pop();
                }
                else {
                    var next = top_1.children[this.dir > 0 ? offset : offset - 1], len = next.length;
                    this.offsets[last] = offset + this.dir;
                    if (skip > len) {
                        skip -= len;
                    }
                    else {
                        this.nodes.push(next);
                        this.offsets.push(this.dir > 0 ? 0 : next instanceof TextLeaf ? next.text.length : next.children.length);
                    }
                }
            }
        };
        return RawTextCursor;
    }());
    var PartialTextCursor = /** @class */ (function () {
        function PartialTextCursor(text, start, end) {
            this.value = "";
            this.cursor = new RawTextCursor(text, start > end ? -1 : 1);
            if (start > end) {
                this.skip = text.length - start;
                this.limit = start - end;
            }
            else {
                this.skip = start;
                this.limit = end - start;
            }
        }
        PartialTextCursor.prototype.next = function () {
            if (this.limit <= 0) {
                this.limit = -1;
            }
            else {
                var _a = this.cursor.next(this.skip), value = _a.value, lineBreak = _a.lineBreak;
                this.skip = 0;
                this.value = value;
                var len = lineBreak ? 1 : value.length;
                if (len > this.limit)
                    this.value = this.cursor.dir > 0 ? value.slice(0, this.limit) : value.slice(len - this.limit);
                this.limit -= this.value.length;
            }
            return this;
        };
        Object.defineProperty(PartialTextCursor.prototype, "lineBreak", {
            get: function () { return this.cursor.lineBreak; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(PartialTextCursor.prototype, "done", {
            get: function () { return this.limit < 0; },
            enumerable: true,
            configurable: true
        });
        return PartialTextCursor;
    }());
    var LineCursor = /** @class */ (function () {
        function LineCursor(text, from) {
            if (from === void 0) { from = 0; }
            this.value = "";
            this.done = false;
            this.cursor = text.iter();
            this.skip = from;
        }
        LineCursor.prototype.next = function () {
            if (this.cursor.done) {
                this.done = true;
                this.value = "";
                return this;
            }
            for (this.value = "";;) {
                var _a = this.cursor.next(this.skip), value = _a.value, lineBreak = _a.lineBreak, done = _a.done;
                this.skip = 0;
                if (done || lineBreak)
                    return this;
                this.value += value;
            }
        };
        Object.defineProperty(LineCursor.prototype, "lineBreak", {
            get: function () { return false; },
            enumerable: true,
            configurable: true
        });
        return LineCursor;
    }());
    var Line = /** @class */ (function () {
        function Line(start, end, number, 
        // @internal
        content) {
            this.start = start;
            this.end = end;
            this.number = number;
            this.content = content;
        }
        Object.defineProperty(Line.prototype, "length", {
            get: function () { return this.end - this.start; },
            enumerable: true,
            configurable: true
        });
        Line.prototype.slice = function (from, to) {
            if (from === void 0) { from = 0; }
            if (to === void 0) { to = this.length; }
            if (typeof this.content == "string")
                return to == from + 1 ? this.content.charAt(from) : this.content.slice(from, to);
            if (from == to)
                return "";
            var result = this.content.slice(from, to);
            if (from == 0 && to == this.length)
                this.content = result;
            return result;
        };
        // @internal
        Line.prototype.finish = function (text) {
            if (this.content == null)
                this.content = new LineContent(text, this.start);
            return this;
        };
        return Line;
    }());
    var LineContent = /** @class */ (function () {
        function LineContent(doc, start) {
            this.doc = doc;
            this.start = start;
            this.cursor = null;
            this.strings = null;
        }
        // FIXME quadratic complexity (somewhat) when iterating long lines in small pieces
        LineContent.prototype.slice = function (from, to) {
            if (!this.cursor) {
                this.cursor = this.doc.iter();
                this.strings = [this.cursor.next(this.start).value];
            }
            for (var result = "", pos = 0, i = 0;; i++) {
                if (i == this.strings.length)
                    this.strings.push(this.cursor.next().value);
                var string = this.strings[i], end = pos + string.length;
                if (end <= from)
                    continue;
                result += string.slice(Math.max(0, from - pos), Math.min(string.length, to - pos));
                if (end >= to)
                    return result;
                pos += string.length;
            }
        };
        return LineContent;
    }());

    var SelectionRange = /** @class */ (function () {
        function SelectionRange(anchor, head) {
            if (head === void 0) { head = anchor; }
            this.anchor = anchor;
            this.head = head;
        }
        Object.defineProperty(SelectionRange.prototype, "from", {
            get: function () { return Math.min(this.anchor, this.head); },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(SelectionRange.prototype, "to", {
            get: function () { return Math.max(this.anchor, this.head); },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(SelectionRange.prototype, "empty", {
            get: function () { return this.anchor == this.head; },
            enumerable: true,
            configurable: true
        });
        SelectionRange.prototype.map = function (mapping) {
            var anchor = mapping.mapPos(this.anchor), head = mapping.mapPos(this.head);
            if (anchor == this.anchor && head == this.head)
                return this;
            else
                return new SelectionRange(anchor, head);
        };
        SelectionRange.prototype.extend = function (from, to) {
            if (to === void 0) { to = from; }
            if (from <= this.anchor && to >= this.anchor)
                return new SelectionRange(from, to);
            var head = Math.abs(from - this.anchor) > Math.abs(to - this.anchor) ? from : to;
            return new SelectionRange(this.anchor, head);
        };
        SelectionRange.prototype.eq = function (other) {
            return this.anchor == other.anchor && this.head == other.head;
        };
        SelectionRange.prototype.toJSON = function () { return this; };
        SelectionRange.fromJSON = function (json) {
            if (!json || typeof json.anchor != "number" || typeof json.head != "number")
                throw new RangeError("Invalid JSON representation for SelectionRange");
            return new SelectionRange(json.anchor, json.head);
        };
        SelectionRange.groupAt = function (state, pos, bias) {
            if (bias === void 0) { bias = 1; }
            // FIXME at some point, take language-specific identifier characters into account
            var line = state.doc.lineAt(pos), linePos = pos - line.start;
            if (line.length == 0)
                return new SelectionRange(pos);
            if (linePos == 0)
                bias = 1;
            else if (linePos == line.length)
                bias = -1;
            var read = linePos + (bias < 0 ? -1 : 0), type = charType(line.slice(read, read + 1));
            var from = pos, to = pos;
            for (var lineFrom = linePos; lineFrom > 0 && charType(line.slice(lineFrom - 1, lineFrom)) == type; lineFrom--)
                from--;
            for (var lineTo = linePos; lineTo < line.length && charType(line.slice(lineTo, lineTo + 1)) == type; lineTo++)
                to++;
            return new SelectionRange(to, from);
        };
        return SelectionRange;
    }());
    var EditorSelection = /** @class */ (function () {
        /** @internal */
        function EditorSelection(ranges, primaryIndex) {
            if (primaryIndex === void 0) { primaryIndex = 0; }
            this.ranges = ranges;
            this.primaryIndex = primaryIndex;
        }
        EditorSelection.prototype.map = function (mapping) {
            return EditorSelection.create(this.ranges.map(function (r) { return r.map(mapping); }), this.primaryIndex);
        };
        EditorSelection.prototype.eq = function (other) {
            if (this.ranges.length != other.ranges.length ||
                this.primaryIndex != other.primaryIndex)
                return false;
            for (var i = 0; i < this.ranges.length; i++)
                if (!this.ranges[i].eq(other.ranges[i]))
                    return false;
            return true;
        };
        Object.defineProperty(EditorSelection.prototype, "primary", {
            get: function () { return this.ranges[this.primaryIndex]; },
            enumerable: true,
            configurable: true
        });
        EditorSelection.prototype.asSingle = function () {
            return this.ranges.length == 1 ? this : new EditorSelection([this.primary]);
        };
        EditorSelection.prototype.addRange = function (range, primary) {
            if (primary === void 0) { primary = true; }
            return EditorSelection.create([range].concat(this.ranges), primary ? 0 : this.primaryIndex + 1);
        };
        EditorSelection.prototype.replaceRange = function (range, which) {
            if (which === void 0) { which = this.primaryIndex; }
            var ranges = this.ranges.slice();
            ranges[which] = range;
            return EditorSelection.create(ranges, this.primaryIndex);
        };
        EditorSelection.prototype.toJSON = function () {
            return this.ranges.length == 1 ? this.ranges[0].toJSON() :
                { ranges: this.ranges.map(function (r) { return r.toJSON(); }), primaryIndex: this.primaryIndex };
        };
        EditorSelection.fromJSON = function (json) {
            if (json && Array.isArray(json.ranges)) {
                if (typeof json.primaryIndex != "number" || json.primaryIndex >= json.ranges.length)
                    throw new RangeError("Invalid JSON representation for EditorSelection");
                return new EditorSelection(json.ranges.map(function (r) { return SelectionRange.fromJSON(r); }), json.primaryIndex);
            }
            return new EditorSelection([SelectionRange.fromJSON(json)]);
        };
        EditorSelection.single = function (anchor, head) {
            if (head === void 0) { head = anchor; }
            return new EditorSelection([new SelectionRange(anchor, head)], 0);
        };
        EditorSelection.create = function (ranges, primaryIndex) {
            if (primaryIndex === void 0) { primaryIndex = 0; }
            for (var pos = 0, i = 0; i < ranges.length; i++) {
                var range = ranges[i];
                if (range.empty ? range.from <= pos : range.from < pos)
                    return normalized(ranges.slice(), primaryIndex);
                pos = range.to;
            }
            return new EditorSelection(ranges, primaryIndex);
        };
        EditorSelection.default = EditorSelection.single(0);
        return EditorSelection;
    }());
    function normalized(ranges, primaryIndex) {
        if (primaryIndex === void 0) { primaryIndex = 0; }
        var primary = ranges[primaryIndex];
        ranges.sort(function (a, b) { return a.from - b.from; });
        primaryIndex = ranges.indexOf(primary);
        for (var i = 1; i < ranges.length; i++) {
            var range = ranges[i], prev = ranges[i - 1];
            if (range.empty ? range.from <= prev.to : range.from < prev.to) {
                var from = prev.from, to = Math.max(range.to, prev.to);
                if (i <= primaryIndex)
                    primaryIndex--;
                ranges.splice(--i, 2, range.anchor > range.head ? new SelectionRange(to, from) : new SelectionRange(from, to));
            }
        }
        return new EditorSelection(ranges, primaryIndex);
    }

    var Slot = /** @class */ (function () {
        // @internal
        function Slot(/* @internal */ type, 
        /* @internal */ value) {
            this.type = type;
            this.value = value;
        }
        Slot.define = function () {
            var type = function (value) { return new Slot(type, value); };
            return type;
        };
        Slot.get = function (type, slots) {
            for (var i = slots.length - 1; i >= 0; i--)
                if (slots[i].type == type)
                    return slots[i].value;
            return undefined;
        };
        return Slot;
    }());
    var Extension = /** @class */ (function () {
        // @internal
        function Extension(/* @internal */ kind, 
        /* @internal */ id, 
        /* @internal */ value, 
        /* @internal */ priority) {
            if (priority === void 0) { priority = -2; }
            this.kind = kind;
            this.id = id;
            this.value = value;
            this.priority = priority;
        }
        Extension.prototype.setPrio = function (priority) {
            // Crude casting because TypeScript doesn't understand new this.constructor
            return new this.constructor(this.kind, this.id, this.value, priority);
        };
        Extension.prototype.fallback = function () { return this.setPrio(-1); };
        Extension.prototype.extend = function () { return this.setPrio(1); };
        Extension.prototype.override = function () { return this.setPrio(2); };
        // @internal
        Extension.prototype.flatten = function (priority, target) {
            if (target === void 0) { target = []; }
            if (this.kind == 1 /* MULTI */)
                for (var _i = 0, _a = this.value; _i < _a.length; _i++) {
                    var ext = _a[_i];
                    ext.flatten(this.priority > -2 ? this.priority : priority, target);
                }
            else
                target.push(this.priority > -2 ? this : this.setPrio(priority));
            return target;
        };
        // Insert this extension in an array of extensions so that it
        // appears after any already-present extensions with the same or
        // lower priority, but before any extensions with higher priority.
        // @internal
        Extension.prototype.collect = function (array) {
            var i = 0;
            while (i < array.length && array[i].priority >= this.priority)
                i++;
            array.splice(i, 0, this);
        };
        // Define a type of behavior, which is the thing that extensions
        // eventually resolve to. Each behavior can have an ordered sequence
        // of values associated with it. An `Extension` can be seen as a
        // tree of sub-extensions with behaviors as leaves.
        Extension.defineBehavior = function () {
            var _this = this;
            var behavior = function (value) { return new _this(0 /* BEHAVIOR */, behavior, value); };
            return behavior;
        };
        Extension.unique = function (instantiate, defaultSpec) {
            var _this = this;
            var type = new UniqueExtensionType(instantiate);
            return function (spec) {
                if (spec === void 0) { spec = defaultSpec; }
                if (spec === undefined)
                    throw new RangeError("This extension has no default spec");
                return new _this(2 /* UNIQUE */, type, spec);
            };
        };
        Extension.all = function () {
            var extensions = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                extensions[_i] = arguments[_i];
            }
            return new this(1 /* MULTI */, null, extensions);
        };
        // Resolve an array of extenders by expanding all extensions until
        // only behaviors are left, and then collecting the behaviors into
        // arrays of values, preserving priority ordering throughout.
        Extension.resolve = function (extensions) {
            var pending = new this(1 /* MULTI */, null, extensions).flatten(0);
            // This does a crude topological ordering to resolve behaviors
            // top-to-bottom in the dependency ordering. If there are no
            // cyclic dependencies, we can always find a behavior in the top
            // `pending` array that isn't a dependency of any unresolved
            // behavior, and thus find and order all its specs in order to
            // resolve them.
            for (var resolved = [];;) {
                var top_1 = findTopUnique(pending, this);
                if (!top_1)
                    break; // Only behaviors left
                // Prematurely evaluated a behavior type because of missing
                // sub-behavior information -- start over, in the assumption
                // that newly gathered information will make the next attempt
                // more successful.
                if (resolved.indexOf(top_1) > -1)
                    return this.resolve(extensions);
                top_1.resolve(pending);
                resolved.push(top_1);
            }
            // Collect the behavior values.
            var store = new BehaviorStore;
            for (var _i = 0, pending_1 = pending; _i < pending_1.length; _i++) {
                var ext = pending_1[_i];
                if (!(ext instanceof this)) {
                    // Collect extensions of the wrong type into store.foreign
                    store.foreign.push(ext);
                    continue;
                }
                if (store.behaviors.indexOf(ext.id) > -1)
                    continue; // Already collected
                var values = [];
                for (var _a = 0, pending_2 = pending; _a < pending_2.length; _a++) {
                    var e = pending_2[_a];
                    if (e.id == ext.id)
                        e.collect(values);
                }
                store.behaviors.push(ext.id);
                store.values.push(values.map(function (v) { return v.value; }));
            }
            return store;
        };
        return Extension;
    }());
    var UniqueExtensionType = /** @class */ (function () {
        function UniqueExtensionType(instantiate) {
            this.instantiate = instantiate;
            this.knownSubs = [];
        }
        UniqueExtensionType.prototype.hasSub = function (type) {
            for (var _i = 0, _a = this.knownSubs; _i < _a.length; _i++) {
                var known = _a[_i];
                if (known == type || known.hasSub(type))
                    return true;
            }
            return false;
        };
        UniqueExtensionType.prototype.resolve = function (extensions) {
            // Replace all instances of this type in extneions with the
            // sub-extensions that instantiating produces.
            var ours = [];
            for (var _i = 0, extensions_1 = extensions; _i < extensions_1.length; _i++) {
                var ext = extensions_1[_i];
                if (ext.id == this)
                    ext.collect(ours);
            }
            var first = true;
            for (var i = 0; i < extensions.length; i++) {
                var ext = extensions[i];
                if (ext.id != this)
                    continue;
                var sub = first ? this.subs(ours.map(function (s) { return s.value; }), ext.priority) : none;
                extensions.splice.apply(extensions, [i, 1].concat(sub));
                first = false;
                i += sub.length - 1;
            }
        };
        UniqueExtensionType.prototype.subs = function (specs, priority) {
            var subs = this.instantiate(specs).flatten(priority);
            for (var _i = 0, subs_1 = subs; _i < subs_1.length; _i++) {
                var sub = subs_1[_i];
                if (sub.kind == 2 /* UNIQUE */ && this.knownSubs.indexOf(sub.id) == -1)
                    this.knownSubs.push(sub.id);
            }
            return subs;
        };
        return UniqueExtensionType;
    }());
    var none = [];
    // An instance of this is part of EditorState and stores the behaviors
    // provided for the state.
    var BehaviorStore = /** @class */ (function () {
        function BehaviorStore() {
            // @internal
            this.behaviors = [];
            // @internal
            this.values = [];
            // Any extensions that weren't an instance of the given type when
            // resolving.
            this.foreign = [];
        }
        BehaviorStore.prototype.get = function (behavior) {
            var found = this.behaviors.indexOf(behavior);
            return found < 0 ? none : this.values[found];
        };
        return BehaviorStore;
    }());
    // Find the extension type that must be resolved next, meaning it is
    // not a (transitive) sub-extension of any other extensions that are
    // still in extenders.
    function findTopUnique(extensions, type) {
        var foundUnique = false;
        var _loop_1 = function (ext) {
            if (ext.kind == 2 /* UNIQUE */ && ext instanceof type) {
                foundUnique = true;
                if (!extensions.some(function (e) { return e.kind == 2 /* UNIQUE */ && e.id.hasSub(ext.id); }))
                    return { value: ext.id };
            }
        };
        for (var _i = 0, extensions_2 = extensions; _i < extensions_2.length; _i++) {
            var ext = extensions_2[_i];
            var state_1 = _loop_1(ext);
            if (typeof state_1 === "object")
                return state_1.value;
        }
        if (foundUnique)
            throw new RangeError("Sub-extension cycle in unique extensions");
        return null;
    }
    // Utility function for combining behaviors to fill in a config
    // object from an array of provided configs. Will, by default, error
    // when a field gets two values that aren't ===-equal, but you can
    // provide combine functions per field to do something else.
    function combineConfig(configs, defaults, combine) {
        if (combine === void 0) { combine = {}; }
        var result = {};
        for (var _i = 0, configs_1 = configs; _i < configs_1.length; _i++) {
            var config = configs_1[_i];
            for (var _a = 0, _b = Object.keys(config); _a < _b.length; _a++) {
                var key = _b[_a];
                var value = config[key], current = result[key];
                if (current === undefined)
                    result[key] = value;
                else if (current === value || value === undefined) ; // No conflict
                else if (Object.hasOwnProperty.call(combine, key))
                    result[key] = combine[key](current, value);
                else
                    throw new Error("Config merge conflict for field " + key);
            }
        }
        for (var key in defaults)
            if (result[key] === undefined)
                result[key] = defaults[key];
        return result;
    }

    var empty = [];
    var ChangeDesc = /** @class */ (function () {
        function ChangeDesc(from, to, length) {
            this.from = from;
            this.to = to;
            this.length = length;
        }
        Object.defineProperty(ChangeDesc.prototype, "invertedDesc", {
            get: function () { return new ChangeDesc(this.from, this.from + this.length, this.to - this.from); },
            enumerable: true,
            configurable: true
        });
        ChangeDesc.prototype.mapPos = function (pos, bias, trackDel) {
            if (bias === void 0) { bias = -1; }
            if (trackDel === void 0) { trackDel = false; }
            var _a = this, from = _a.from, to = _a.to, length = _a.length;
            if (pos < from)
                return pos;
            if (pos > to)
                return pos + (length - (to - from));
            if (pos == to || pos == from)
                return (from == to ? bias <= 0 : pos == from) ? from : from + length;
            pos = from + (bias <= 0 ? 0 : length);
            return trackDel ? -pos - 1 : pos;
        };
        ChangeDesc.prototype.toJSON = function () { return this; };
        ChangeDesc.fromJSON = function (json) {
            if (!json || typeof json.from != "number" || typeof json.to != "number" || typeof json.length != "number")
                throw new RangeError("Invalid JSON representation for ChangeDesc");
            return new ChangeDesc(json.from, json.to, json.length);
        };
        return ChangeDesc;
    }());
    var Change = /** @class */ (function (_super) {
        __extends(Change, _super);
        function Change(from, to, text) {
            var _this = _super.call(this, from, to, textLength$1(text)) || this;
            _this.from = from;
            _this.to = to;
            _this.text = text;
            return _this;
        }
        Change.prototype.invert = function (doc) {
            return new Change(this.from, this.from + this.length, doc.sliceLines(this.from, this.to));
        };
        Change.prototype.apply = function (doc) {
            return doc.replace(this.from, this.to, this.text);
        };
        Change.prototype.map = function (mapping) {
            var from = mapping.mapPos(this.from, 1), to = mapping.mapPos(this.to, -1);
            return from > to ? null : new Change(from, to, this.text);
        };
        Object.defineProperty(Change.prototype, "desc", {
            get: function () { return new ChangeDesc(this.from, this.to, this.length); },
            enumerable: true,
            configurable: true
        });
        Change.prototype.toJSON = function () {
            return { from: this.from, to: this.to, text: this.text };
        };
        Change.fromJSON = function (json) {
            if (!json || typeof json.from != "number" || typeof json.to != "number" ||
                !Array.isArray(json.text) || json.text.some(function (val) { return typeof val != "string"; }))
                throw new RangeError("Invalid JSON representation for Change");
            return new Change(json.from, json.to, json.text);
        };
        return Change;
    }(ChangeDesc));
    function textLength$1(text) {
        var length = -1;
        for (var _i = 0, text_1 = text; _i < text_1.length; _i++) {
            var line = text_1[_i];
            length += line.length + 1;
        }
        return length;
    }
    var ChangeSet = /** @class */ (function () {
        function ChangeSet(changes, mirror) {
            if (mirror === void 0) { mirror = empty; }
            this.changes = changes;
            this.mirror = mirror;
        }
        Object.defineProperty(ChangeSet.prototype, "length", {
            get: function () {
                return this.changes.length;
            },
            enumerable: true,
            configurable: true
        });
        ChangeSet.prototype.getMirror = function (n) {
            for (var i = 0; i < this.mirror.length; i++)
                if (this.mirror[i] == n)
                    return this.mirror[i + (i % 2 ? -1 : 1)];
            return null;
        };
        ChangeSet.prototype.append = function (change, mirror) {
            return new ChangeSet(this.changes.concat(change), mirror != null ? this.mirror.concat(this.length, mirror) : this.mirror);
        };
        ChangeSet.prototype.appendSet = function (changes) {
            var _this = this;
            return changes.length == 0 ? this :
                this.length == 0 ? changes :
                    new ChangeSet(this.changes.concat(changes.changes), this.mirror.concat(changes.mirror.map(function (i) { return i + _this.length; })));
        };
        ChangeSet.prototype.mapPos = function (pos, bias, trackDel) {
            if (bias === void 0) { bias = -1; }
            if (trackDel === void 0) { trackDel = false; }
            return this.mapInner(pos, bias, trackDel, 0, this.length);
        };
        /** @internal */
        ChangeSet.prototype.mapInner = function (pos, bias, trackDel, fromI, toI) {
            var dir = toI < fromI ? -1 : 1;
            var recoverables = null;
            var hasMirrors = this.mirror.length > 0, rec, mirror, deleted = false;
            for (var i = fromI - (dir < 0 ? 1 : 0), endI = toI - (dir < 0 ? 1 : 0); i != endI; i += dir) {
                var _a = this.changes[i], from = _a.from, to = _a.to, length_1 = _a.length;
                if (dir < 0) {
                    var len = to - from;
                    to = from + length_1;
                    length_1 = len;
                }
                if (pos < from)
                    continue;
                if (pos > to) {
                    pos += length_1 - (to - from);
                    continue;
                }
                // Change touches this position
                if (recoverables && (rec = recoverables[i]) != null) { // There's a recovery for this change, and it applies
                    pos = from + rec;
                    continue;
                }
                if (hasMirrors && (mirror = this.getMirror(i)) != null &&
                    (dir > 0 ? mirror > i && mirror < toI : mirror < i && mirror >= toI)) { // A mirror exists
                    if (pos > from && pos < to) { // If this change deletes the position, skip forward to the mirror
                        i = mirror;
                        pos = this.changes[i].from + (pos - from);
                        continue;
                    }
                    (recoverables || (recoverables = {}))[mirror] = pos - from;
                }
                if (pos > from && pos < to) {
                    deleted = true;
                    pos = bias <= 0 ? from : from + length_1;
                }
                else {
                    pos = (from == to ? bias <= 0 : pos == from) ? from : from + length_1;
                }
            }
            return trackDel && deleted ? -pos - 1 : pos;
        };
        ChangeSet.prototype.partialMapping = function (from, to) {
            if (to === void 0) { to = this.length; }
            if (from == 0 && to == this.length)
                return this;
            return new PartialMapping(this, from, to);
        };
        ChangeSet.prototype.changedRanges = function () {
            var set = [];
            for (var i = 0; i < this.length; i++) {
                var change = this.changes[i];
                var fromA = change.from, toA = change.to, fromB = change.from, toB = change.from + change.length;
                if (i < this.length - 1) {
                    var mapping = this.partialMapping(i + 1);
                    fromB = mapping.mapPos(fromB, 1);
                    toB = mapping.mapPos(toB, -1);
                }
                if (i > 0) {
                    var mapping = this.partialMapping(i, 0);
                    fromA = mapping.mapPos(fromA, 1);
                    toA = mapping.mapPos(toA, -1);
                }
                new ChangedRange(fromA, toA, fromB, toB).addToSet(set);
            }
            return set;
        };
        Object.defineProperty(ChangeSet.prototype, "desc", {
            get: function () {
                if (this.changes.length == 0 || this.changes[0] instanceof ChangeDesc)
                    return this;
                return new ChangeSet(this.changes.map(function (ch) { return ch.desc; }), this.mirror);
            },
            enumerable: true,
            configurable: true
        });
        ChangeSet.prototype.toJSON = function () {
            var changes = this.changes.map(function (change) { return change.toJSON(); });
            return this.mirror.length == 0 ? changes : { mirror: this.mirror, changes: changes };
        };
        ChangeSet.fromJSON = function (ChangeType, json) {
            var mirror, changes;
            if (Array.isArray(json)) {
                mirror = empty;
                changes = json;
            }
            else if (!json || !Array.isArray(json.mirror) || !Array.isArray(json.changes)) {
                throw new RangeError("Invalid JSON representation for ChangeSet");
            }
            else {
                (mirror = json.mirror, changes = json.changes);
            }
            return new ChangeSet(changes.map(function (ch) { return ChangeType.fromJSON(ch); }), mirror);
        };
        ChangeSet.empty = new ChangeSet(empty);
        return ChangeSet;
    }());
    var PartialMapping = /** @class */ (function () {
        function PartialMapping(changes, from, to) {
            this.changes = changes;
            this.from = from;
            this.to = to;
        }
        PartialMapping.prototype.mapPos = function (pos, bias, trackDel) {
            if (bias === void 0) { bias = -1; }
            if (trackDel === void 0) { trackDel = false; }
            return this.changes.mapInner(pos, bias, trackDel, this.from, this.to);
        };
        return PartialMapping;
    }());
    var ChangedRange = /** @class */ (function () {
        function ChangedRange(fromA, toA, fromB, toB) {
            this.fromA = fromA;
            this.toA = toA;
            this.fromB = fromB;
            this.toB = toB;
        }
        ChangedRange.prototype.join = function (other) {
            return new ChangedRange(Math.min(this.fromA, other.fromA), Math.max(this.toA, other.toA), Math.min(this.fromB, other.fromB), Math.max(this.toB, other.toB));
        };
        ChangedRange.prototype.addToSet = function (set) {
            var i = set.length, me = this;
            for (; i > 0; i--) {
                var range = set[i - 1];
                if (range.fromA > me.toA)
                    continue;
                if (range.toA < me.fromA)
                    break;
                me = me.join(range);
                set.splice(i - 1, 1);
            }
            set.splice(i, 0, me);
            return set;
        };
        ChangedRange.prototype.subtractFromSet = function (set) {
            for (var i = 0; i < set.length; i++) {
                var range = set[i];
                if (range.fromA >= this.toA && range.fromB >= this.toB)
                    break;
                if (range.toA <= this.fromA && range.toB <= this.fromB)
                    continue;
                var replace = [];
                if (range.fromA < this.fromA || range.fromB < this.fromB)
                    replace.push(new ChangedRange(range.fromA, this.fromA, range.fromB, this.fromB));
                if (range.toA > this.toA || range.toB > this.toB)
                    replace.push(new ChangedRange(this.toA, range.toA, range.toB, this.toB));
                set.splice.apply(set, [i, 1].concat(replace));
                i = i + replace.length - 1;
            }
            return set;
        };
        Object.defineProperty(ChangedRange.prototype, "lenDiff", {
            get: function () { return (this.toB - this.fromB) - (this.toA - this.fromA); },
            enumerable: true,
            configurable: true
        });
        ChangedRange.mapPos = function (pos, bias, changes) {
            var off = 0;
            for (var _i = 0, changes_1 = changes; _i < changes_1.length; _i++) {
                var range = changes_1[_i];
                if (pos < range.fromA)
                    break;
                if (pos <= range.toA) {
                    var side = range.toA == range.fromA ? bias : pos == range.fromA ? -1 : pos == range.toA ? 1 : bias;
                    return side < 0 ? range.fromB : range.toB;
                }
                off = range.toB - range.toA;
            }
            return pos + off;
        };
        return ChangedRange;
    }());

    var empty$1 = [];
    var FLAG_SELECTION_SET = 1, FLAG_SCROLL_INTO_VIEW = 2;
    var Transaction = /** @class */ (function () {
        function Transaction(startState, changes, docs, selection, metadata, flags) {
            this.startState = startState;
            this.changes = changes;
            this.docs = docs;
            this.selection = selection;
            this.metadata = metadata;
            this.flags = flags;
        }
        Transaction.start = function (state, time) {
            if (time === void 0) { time = Date.now(); }
            return new Transaction(state, ChangeSet.empty, empty$1, state.selection, [Transaction.time(time)], 0);
        };
        Object.defineProperty(Transaction.prototype, "doc", {
            get: function () {
                var last = this.docs.length - 1;
                return last < 0 ? this.startState.doc : this.docs[last];
            },
            enumerable: true,
            configurable: true
        });
        Transaction.prototype.addMeta = function () {
            var metadata = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                metadata[_i] = arguments[_i];
            }
            return new Transaction(this.startState, this.changes, this.docs, this.selection, this.metadata.concat(metadata), this.flags);
        };
        Transaction.prototype.getMeta = function (type) {
            return Slot.get(type, this.metadata);
        };
        Transaction.prototype.change = function (change, mirror) {
            if (change.from == change.to && change.length == 0)
                return this;
            if (change.from < 0 || change.to < change.from || change.to > this.doc.length)
                throw new RangeError("Invalid change " + change.from + " to " + change.to);
            var changes = this.changes.append(change, mirror);
            return new Transaction(this.startState, changes, this.docs.concat(change.apply(this.doc)), this.selection.map(changes.partialMapping(changes.length - 1)), this.metadata, this.flags);
        };
        Transaction.prototype.replace = function (from, to, text) {
            return this.change(new Change(from, to, typeof text == "string" ? this.startState.splitLines(text) : text));
        };
        Transaction.prototype.replaceSelection = function (text) {
            var content = typeof text == "string" ? this.startState.splitLines(text) : text;
            return this.reduceRanges(function (state, r) {
                var change = new Change(r.from, r.to, content);
                return { transaction: state.change(change), range: new SelectionRange(r.from + change.length) };
            });
        };
        Transaction.prototype.reduceRanges = function (f) {
            var tr = this;
            var sel = tr.selection, start = tr.changes.length, newRanges = [];
            for (var _i = 0, _a = sel.ranges; _i < _a.length; _i++) {
                var range = _a[_i];
                range = range.map(tr.changes.partialMapping(start));
                var result = f(tr, range);
                if (result instanceof Transaction) {
                    tr = result;
                    newRanges.push(range.map(tr.changes.partialMapping(tr.changes.length - 1)));
                }
                else {
                    tr = result.transaction;
                    newRanges.push(result.range);
                }
            }
            return tr.setSelection(EditorSelection.create(newRanges, sel.primaryIndex));
        };
        Transaction.prototype.mapRanges = function (f) {
            return this.reduceRanges(function (tr, range) { return ({ transaction: tr, range: f(range) }); });
        };
        Transaction.prototype.setSelection = function (selection) {
            return new Transaction(this.startState, this.changes, this.docs, this.startState.multipleSelections ? selection : selection.asSingle(), this.metadata, this.flags | FLAG_SELECTION_SET);
        };
        Object.defineProperty(Transaction.prototype, "selectionSet", {
            get: function () {
                return (this.flags & FLAG_SELECTION_SET) > 0;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(Transaction.prototype, "docChanged", {
            get: function () {
                return this.changes.length > 0;
            },
            enumerable: true,
            configurable: true
        });
        Transaction.prototype.scrollIntoView = function () {
            return new Transaction(this.startState, this.changes, this.docs, this.selection, this.metadata, this.flags | FLAG_SCROLL_INTO_VIEW);
        };
        Object.defineProperty(Transaction.prototype, "scrolledIntoView", {
            get: function () {
                return (this.flags & FLAG_SCROLL_INTO_VIEW) > 0;
            },
            enumerable: true,
            configurable: true
        });
        Transaction.prototype.apply = function () {
            return this.startState.applyTransaction(this);
        };
        Transaction.prototype.invertedChanges = function () {
            if (!this.changes.length)
                return ChangeSet.empty;
            var changes = [], set = this.changes;
            for (var i = set.length - 1; i >= 0; i--)
                changes.push(set.changes[i].invert(i == 0 ? this.startState.doc : this.docs[i - 1]));
            return new ChangeSet(changes, set.mirror.length ? set.mirror.map(function (i) { return set.length - i - 1; }) : set.mirror);
        };
        Transaction.time = Slot.define();
        Transaction.changeTabSize = Slot.define();
        Transaction.changeLineSeparator = Slot.define();
        Transaction.preserveGoalColumn = Slot.define();
        Transaction.userEvent = Slot.define();
        Transaction.addToHistory = Slot.define();
        return Transaction;
    }());

    var StateExtension = /** @class */ (function (_super) {
        __extends(StateExtension, _super);
        function StateExtension() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        StateExtension.allowMultipleSelections = StateExtension.defineBehavior();
        StateExtension.indentation = StateExtension.defineBehavior();
        return StateExtension;
    }(Extension));
    var Configuration = /** @class */ (function () {
        function Configuration(behavior, fields, multipleSelections, tabSize, lineSeparator) {
            this.behavior = behavior;
            this.fields = fields;
            this.multipleSelections = multipleSelections;
            this.tabSize = tabSize;
            this.lineSeparator = lineSeparator;
        }
        Configuration.create = function (config) {
            var behavior = StateExtension.resolve(config.extensions || []);
            return new Configuration(behavior, behavior.get(stateFieldBehavior), behavior.get(StateExtension.allowMultipleSelections).some(function (x) { return x; }), config.tabSize || 4, config.lineSeparator || null);
        };
        Configuration.prototype.updateTabSize = function (tabSize) {
            return new Configuration(this.behavior, this.fields, this.multipleSelections, tabSize, this.lineSeparator);
        };
        Configuration.prototype.updateLineSeparator = function (lineSep) {
            return new Configuration(this.behavior, this.fields, this.multipleSelections, this.tabSize, lineSep);
        };
        return Configuration;
    }());
    var EditorState = /** @class */ (function () {
        /** @internal */
        function EditorState(/* @internal */ config, fields, doc, selection) {
            this.config = config;
            this.fields = fields;
            this.doc = doc;
            this.selection = selection;
            for (var _i = 0, _a = selection.ranges; _i < _a.length; _i++) {
                var range = _a[_i];
                if (range.to > doc.length)
                    throw new RangeError("Selection points outside of document");
            }
        }
        EditorState.prototype.getField = function (field) {
            var index = this.config.fields.indexOf(field);
            if (index < 0)
                throw new RangeError("Field is not present in this state");
            if (index >= this.fields.length)
                throw new RangeError("Field hasn't been initialized yet");
            return this.fields[index];
        };
        /** @internal */
        EditorState.prototype.applyTransaction = function (tr) {
            var $conf = this.config;
            var tabSize = tr.getMeta(Transaction.changeTabSize), lineSep = tr.getMeta(Transaction.changeLineSeparator);
            if (tabSize !== undefined)
                $conf = $conf.updateTabSize(tabSize);
            // FIXME changing the line separator might involve rearranging line endings (?)
            if (lineSep !== undefined)
                $conf = $conf.updateLineSeparator(lineSep);
            var fields = [];
            var newState = new EditorState($conf, fields, tr.doc, tr.selection);
            for (var i = 0; i < this.fields.length; i++)
                fields[i] = $conf.fields[i].apply(tr, this.fields[i], newState);
            return newState;
        };
        Object.defineProperty(EditorState.prototype, "transaction", {
            get: function () {
                return Transaction.start(this);
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(EditorState.prototype, "tabSize", {
            get: function () { return this.config.tabSize; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(EditorState.prototype, "multipleSelections", {
            get: function () { return this.config.multipleSelections; },
            enumerable: true,
            configurable: true
        });
        EditorState.prototype.joinLines = function (text) { return joinLines(text, this.config.lineSeparator || undefined); };
        EditorState.prototype.splitLines = function (text) { return splitLines(text, this.config.lineSeparator || undefined); };
        Object.defineProperty(EditorState.prototype, "behavior", {
            get: function () { return this.config.behavior; },
            enumerable: true,
            configurable: true
        });
        // FIXME plugin state serialization
        EditorState.prototype.toJSON = function () {
            return {
                doc: this.joinLines(this.doc.sliceLines(0, this.doc.length)),
                selection: this.selection.toJSON(),
                lineSeparator: this.config.lineSeparator,
                tabSize: this.tabSize
            };
        };
        EditorState.fromJSON = function (json, config) {
            if (config === void 0) { config = {}; }
            if (!json || (json.lineSeparator && typeof json.lineSeparator != "string") ||
                typeof json.tabSize != "number" || typeof json.doc != "string")
                throw new RangeError("Invalid JSON representation for EditorState");
            return EditorState.create({
                doc: json.doc,
                selection: EditorSelection.fromJSON(json.selection),
                extensions: config.extensions,
                tabSize: config.tabSize,
                lineSeparator: config.lineSeparator
            });
        };
        EditorState.create = function (config) {
            if (config === void 0) { config = {}; }
            var $config = Configuration.create(config);
            var doc = config.doc instanceof Text ? config.doc
                : Text.of(config.doc || "", config.lineSeparator || undefined);
            var selection = config.selection || EditorSelection.default;
            if (!$config.multipleSelections)
                selection = selection.asSingle();
            var fields = [];
            var state = new EditorState($config, fields, doc, selection);
            for (var _i = 0, _a = $config.fields; _i < _a.length; _i++) {
                var field = _a[_i];
                fields.push(field.init(state));
            }
            return state;
        };
        return EditorState;
    }());
    var stateFieldBehavior = StateExtension.defineBehavior();
    var StateField = /** @class */ (function () {
        function StateField(_a) {
            var init = _a.init, apply = _a.apply;
            this.init = init;
            this.apply = apply;
            this.extension = stateFieldBehavior(this);
        }
        return StateField;
    }());

    var commonjsGlobal = typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

    function createCommonjsModule(fn, module) {
    	return module = { exports: {} }, fn(module, module.exports), module.exports;
    }

    var styleMod = createCommonjsModule(function (module, exports) {
    function sym(name, random) {
      return typeof Symbol == "undefined"
        ? "__" + name + (random ? Math.floor(Math.random() * 1e8) : "")
        : random ? Symbol(name) : Symbol.for(name)
    }

    var COUNT = sym("\u037c"), SET = sym("styleSet", 1), DATA = sym("data", 1);
    var top = typeof commonjsGlobal == "undefined" ? window : commonjsGlobal;

    // ::- A style module defines a number of CSS classes and generates
    // names for them. Instances of this class bind the property names
    // from `spec` to CSS class names that assign the styles in the
    // corresponding property values.
    //
    // A style module can only be used in a given DOM root after it has
    // been _mounted_ there with `StyleModule.mount`.
    //
    // By default, rules are defined in the order in which they are
    // mounted, making those mounted later take precedence in case of an
    // otherwise equal selector precedence. You can pass 0 for low
    // priority or 2 for high priority as second argument to explicitly
    // move the rules above or below rules with default priority. Within a
    // priority level, rules remain defined in mount order.
    //
    // Style modules should be created once and stored somewhere, as
    // opposed to re-creating them every time you need them. The amount of
    // CSS rules generated for a given DOM root is bounded by the amount
    // of style modules that were used. To avoid leaking rules, don't
    // create these dynamically, but treat them as one-time allocations.
    var StyleModule = exports.StyleModule = function StyleModule(spec, options) {
      var priority = options && options.priority;
      if (priority == null) { priority = 1; }
      if (priority < 0 || priority > 2 || +priority != priority) { throw new RangeError("Invalid priority: " + priority) }
      this[DATA] = {rules: [], mounted: [], priority: priority};
      top[COUNT] = top[COUNT] || 1;
      for (var name in spec) {
        var className = this[name] = "\u037c" + (top[COUNT]++).toString(36);
        renderStyle("." + className, spec[name], this[DATA].rules);
      }
    };

    // :: (union<Document, ShadowRoot>, Object<string>)
    //
    // Mount the given module in the given DOM root, which ensures that
    // the CSS rules defined by the module are available in that context.
    //
    // This function can be called multiple times with the same arguments
    // cheaply—rules are only added to the document once per root.
    StyleModule.mount = function mount (root, module) {
      var data = module[DATA];
      if (data.mounted.indexOf(root) > -1) { return
      ; }(root[SET] || new StyleSet(root)).mount(data.rules, data.priority);
      data.mounted.push(root);
    };

    StyleModule.prototype = Object.create(null);

    var StyleSet = function StyleSet(root) {
      this.root = root;
      root[SET] = this;
      this.styleTag = (root.ownerDocument || root).createElement("style");
      var target = root.head || root;
      target.insertBefore(this.styleTag, target.firstChild);
      this.insertPos = [0, 0, 0];
      this.rules = [];
    };

    StyleSet.prototype.mount = function mount (rules, priority) {
        var ref;

      var pos = this.insertPos[priority]
      ;(ref = this.rules).splice.apply(ref, [ pos, 0 ].concat( rules ));
      var sheet = this.styleTag.sheet;
      if (sheet) {
        for (var i = 0; i < rules.length; i++)
          { sheet.insertRule(rules[i], pos++); }
      } else {
        this.styleTag.textContent = this.rules.join("\n");
      }
      for (var i$1 = priority; i$1 < this.insertPos.length; i$1++)
        { this.insertPos[i$1] += rules.length; }
    };

    function renderStyle(selector, spec, output) {
      if (typeof spec != "object") { throw new RangeError("Expected style object, got " + JSON.stringify(spec)) }
      var props = [];
      for (var prop in spec) {
        if (/^@/.test(prop)) {
          var local = [];
          renderStyle(selector, spec[prop], local);
          output.push(prop + " {" + local.join(" ") + "}");
        } else if (/&/.test(prop)) {
          renderStyle(prop.replace(/&/g, selector), spec[prop], output);
        } else {
          if (typeof spec[prop] == "object") { throw new RangeError("The value of a property (" + prop + ") should be a primitive value.") }
          props.push(prop.replace(/_.*/, "").replace(/[A-Z]/g, function (l) { return "-" + l.toLowerCase(); }) + ": " + spec[prop]);
        }
      }
      if (props.length) { output.push(selector + " {" + props.join("; ") + "}"); }
    }

    // Style::Object<union<Style,string>>
    //
    // A style is an object that, in the simple case, maps CSS property
    // names to strings holding their values, as in `{color: "red",
    // fontWeight: "bold"}`. The property names can be given in
    // camel-case—the library will insert a dash before capital letters
    // when converting them to CSS.
    //
    // If you include an underscore in a property name, it and everything
    // after it will be removed from the output, which can be useful when
    // providing a property multiple times, for browser compatibility
    // reasons.
    //
    // A property in a style object can also be a sub-selector, which
    // extends the current context to add a pseudo-selector or a child
    // selector. Such a property should contain a `&` character, which
    // will be replaced by the current selector. For example `{"&:before":
    // {content: '"hi"'}}`. Sub-selectors and regular properties can
    // freely be mixed in a given object. Any property containing a `&` is
    // assumed to be a sub-selector.
    //
    // Finally, a property can specify an @-block to be wrapped around the
    // styles defined inside the object that's the property's value. For
    // example to create a media query you can do `{"@media screen and
    // (min-width: 400px)": {...}}`.
    });
    var styleMod_1 = styleMod.StyleModule;

    var _a = typeof navigator != "undefined"
        ? [navigator, document]
        : [{ userAgent: "", vendor: "", platform: "" }, { documentElement: { style: {} } }], nav = _a[0], doc = _a[1];
    var ie_edge = /Edge\/(\d+)/.exec(nav.userAgent);
    var ie_upto10 = /MSIE \d/.test(nav.userAgent);
    var ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(nav.userAgent);
    var ie = !!(ie_upto10 || ie_11up || ie_edge);
    var gecko = !ie && /gecko\/(\d+)/i.test(nav.userAgent);
    var chrome = !ie && /Chrome\/(\d+)/.exec(nav.userAgent);
    var webkit = !ie && 'WebkitAppearance' in doc.documentElement.style;
    var browser = {
        mac: /Mac/.test(nav.platform),
        ie: ie,
        ie_version: ie_upto10 ? doc.documentMode || 6 : ie_11up ? +ie_11up[1] : ie_edge ? +ie_edge[1] : 0,
        gecko: gecko,
        gecko_version: gecko ? +(/Firefox\/(\d+)/.exec(nav.userAgent) || [0, 0])[1] : 0,
        chrome: !!chrome,
        chrome_version: chrome ? +chrome[1] : 0,
        ios: !ie && /AppleWebKit/.test(nav.userAgent) && /Mobile\/\w+/.test(nav.userAgent),
        android: /Android\b/.test(nav.userAgent),
        webkit: webkit,
        safari: /Apple Computer/.test(nav.vendor),
        webkit_version: webkit ? +(/\bAppleWebKit\/(\d+)/.exec(navigator.userAgent) || [0, 0])[1] : 0
    };

    // Work around Chrome issue https://bugs.chromium.org/p/chromium/issues/detail?id=447523
    // (isCollapsed inappropriately returns true in shadow dom)
    function selectionCollapsed(domSel) {
        var collapsed = domSel.isCollapsed;
        if (collapsed && browser.chrome && domSel.rangeCount && !domSel.getRangeAt(0).collapsed)
            collapsed = false;
        return collapsed;
    }
    function hasSelection(dom, selection) {
        if (!selection.anchorNode)
            return false;
        try {
            // Firefox will raise 'permission denied' errors when accessing
            // properties of `sel.anchorNode` when it's in a generated CSS
            // element.
            return dom.contains(selection.anchorNode.nodeType == 3 ? selection.anchorNode.parentNode : selection.anchorNode);
        }
        catch (_) {
            return false;
        }
    }
    function clientRectsFor(dom) {
        if (dom.nodeType == 3) {
            var range = document.createRange();
            range.setEnd(dom, dom.nodeValue.length);
            range.setStart(dom, 0);
            return range.getClientRects();
        }
        else if (dom.nodeType == 1) {
            return dom.getClientRects();
        }
        else {
            return [];
        }
    }
    // Scans forward and backward through DOM positions equivalent to the
    // given one to see if the two are in the same place (i.e. after a
    // text node vs at the end of that text node)
    function isEquivalentPosition(node, off, targetNode, targetOff) {
        return targetNode ? (scanFor(node, off, targetNode, targetOff, -1) ||
            scanFor(node, off, targetNode, targetOff, 1)) : false;
    }
    function domIndex(node) {
        for (var index = 0;; index++) {
            node = node.previousSibling;
            if (!node)
                return index;
        }
    }
    function scanFor(node, off, targetNode, targetOff, dir) {
        for (;;) {
            if (node == targetNode && off == targetOff)
                return true;
            if (off == (dir < 0 ? 0 : maxOffset(node))) {
                if (node.nodeName == "DIV")
                    return false;
                var parent_1 = node.parentNode;
                if (!parent_1 || parent_1.nodeType != 1)
                    return false;
                off = domIndex(node) + (dir < 0 ? 0 : 1);
                node = parent_1;
            }
            else if (node.nodeType == 1) {
                node = node.childNodes[off + (dir < 0 ? -1 : 0)];
                off = dir < 0 ? maxOffset(node) : 0;
            }
            else {
                return false;
            }
        }
    }
    function maxOffset(node) {
        return node.nodeType == 3 ? node.nodeValue.length : node.childNodes.length;
    }
    function windowRect(win) {
        return { left: 0, right: win.innerWidth,
            top: 0, bottom: win.innerHeight };
    }
    function scrollRectIntoView(dom, rect) {
        var scrollThreshold = 0, scrollMargin = 5;
        var doc = dom.ownerDocument, win = doc.defaultView;
        var gutterCover = 0, prev = dom.previousSibling;
        if (prev && getComputedStyle(prev).position == "sticky")
            gutterCover = dom.offsetLeft;
        for (var cur = dom.parentNode; cur;) {
            if (cur.nodeType == 1) { // Element or document
                var bounding = void 0, top_1 = cur == document.body;
                if (top_1) {
                    bounding = windowRect(win);
                }
                else {
                    if (cur.scrollHeight <= cur.clientHeight && cur.scrollWidth <= cur.clientWidth) {
                        cur = cur.parentNode;
                        continue;
                    }
                    var rect_1 = cur.getBoundingClientRect();
                    bounding = { left: rect_1.left, right: rect_1.left + cur.clientWidth,
                        top: rect_1.top, bottom: rect_1.top + cur.clientHeight };
                }
                var moveX = 0, moveY = 0;
                if (rect.top < bounding.top + scrollThreshold)
                    moveY = -(bounding.top - rect.top + scrollMargin);
                else if (rect.bottom > bounding.bottom - scrollThreshold)
                    moveY = rect.bottom - bounding.bottom + scrollMargin;
                if (rect.left < bounding.left + gutterCover + scrollThreshold)
                    moveX = -(bounding.left + gutterCover - rect.left + scrollMargin);
                else if (rect.right > bounding.right - scrollThreshold)
                    moveX = rect.right - bounding.right + scrollMargin;
                if (moveX || moveY) {
                    if (top_1) {
                        win.scrollBy(moveX, moveY);
                    }
                    else {
                        if (moveY)
                            cur.scrollTop += moveY;
                        if (moveX)
                            cur.scrollLeft += moveX;
                        rect = { left: rect.left - moveX, top: rect.top - moveY,
                            right: rect.right - moveX, bottom: rect.bottom - moveY };
                    }
                }
                if (top_1)
                    break;
                cur = cur.parentNode;
            }
            else if (cur.nodeType == 11) { // A shadow root
                cur = cur.host;
            }
            else {
                break;
            }
        }
    }
    var DOMSelection = /** @class */ (function () {
        function DOMSelection() {
            this.anchorNode = null;
            this.anchorOffset = 0;
            this.focusNode = null;
            this.focusOffset = 0;
        }
        DOMSelection.prototype.eq = function (domSel) {
            return this.anchorNode == domSel.anchorNode && this.anchorOffset == domSel.anchorOffset &&
                this.focusNode == domSel.focusNode && this.focusOffset == domSel.focusOffset;
        };
        DOMSelection.prototype.set = function (domSel) {
            this.anchorNode = domSel.anchorNode;
            this.anchorOffset = domSel.anchorOffset;
            this.focusNode = domSel.focusNode;
            this.focusOffset = domSel.focusOffset;
        };
        return DOMSelection;
    }());

    var none$1 = [];
    var ContentView = /** @class */ (function () {
        function ContentView() {
            this.parent = null;
            this.dom = null;
            this.dirty = 2 /* node */;
        }
        Object.defineProperty(ContentView.prototype, "childGap", {
            get: function () { return 0; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(ContentView.prototype, "overrideDOMText", {
            get: function () { return null; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(ContentView.prototype, "posAtStart", {
            get: function () {
                return this.parent ? this.parent.posBefore(this) : 0;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(ContentView.prototype, "posAtEnd", {
            get: function () {
                return this.posAtStart + this.length;
            },
            enumerable: true,
            configurable: true
        });
        ContentView.prototype.posBefore = function (view) {
            var pos = this.posAtStart;
            for (var _i = 0, _a = this.children; _i < _a.length; _i++) {
                var child = _a[_i];
                if (child == view)
                    return pos;
                pos += child.length + this.childGap;
            }
            throw new RangeError("Invalid child in posBefore");
        };
        ContentView.prototype.posAfter = function (view) {
            return this.posBefore(view) + view.length;
        };
        ContentView.prototype.coordsAt = function (pos) {
            for (var off = 0, i = 0; i < this.children.length; i++) {
                var child = this.children[i], end = off + child.length;
                if (end >= pos && (end != off || this.childGap))
                    return child.coordsAt(pos - off);
                off = end + this.childGap;
            }
            return null;
        };
        ContentView.prototype.syncInto = function (parent, pos) {
            return syncNodeInto(parent, pos, this.dom);
        };
        ContentView.prototype.syncDOMChildren = function () {
            var parent = this.dom, pos = parent.firstChild;
            for (var _i = 0, _a = this.children; _i < _a.length; _i++) {
                var view = _a[_i];
                pos = view.syncInto(parent, pos);
            }
            while (pos)
                pos = rm(pos);
        };
        ContentView.prototype.sync = function () {
            if (this.dirty & 2 /* node */)
                this.syncDOMChildren();
            if (this.dirty & 1 /* child */)
                for (var _i = 0, _a = this.children; _i < _a.length; _i++) {
                    var child = _a[_i];
                    if (child.dirty)
                        child.sync();
                }
            this.dirty = 0 /* not */;
        };
        ContentView.prototype.domFromPos = function (pos) { return null; };
        ContentView.prototype.localPosFromDOM = function (node, offset) {
            var after;
            if (node == this.dom) {
                after = this.dom.childNodes[offset];
            }
            else {
                var bias = maxOffset(node) == 0 ? 0 : offset == 0 ? -1 : 1;
                for (;;) {
                    var parent_1 = node.parentNode;
                    if (parent_1 == this.dom)
                        break;
                    if (bias == 0 && parent_1.firstChild != parent_1.lastChild) {
                        if (node == parent_1.firstChild)
                            bias = -1;
                        else
                            bias = 1;
                    }
                    node = parent_1;
                }
                if (bias < 0)
                    after = node;
                else
                    after = node.nextSibling;
            }
            if (after == this.dom.firstChild)
                return 0;
            while (after && !after.cmView)
                after = after.nextSibling;
            if (!after)
                return this.length;
            for (var i = 0, pos = 0;; i++) {
                var child = this.children[i];
                if (child.dom == after)
                    return pos;
                pos += child.length + this.childGap;
            }
        };
        ContentView.prototype.domBoundsAround = function (from, to, offset) {
            if (offset === void 0) { offset = 0; }
            var fromI = -1, fromStart = -1, toI = -1, toEnd = -1;
            for (var i = 0, pos = offset; i < this.children.length; i++) {
                var child = this.children[i], end = pos + child.length;
                if (pos < from && end > to)
                    return child.domBoundsAround(from, to, pos);
                if (end >= from && fromI == -1) {
                    fromI = i;
                    fromStart = pos;
                }
                if (end >= to && toI == -1) {
                    toI = i;
                    toEnd = end;
                    break;
                }
                pos = end + this.childGap;
            }
            return { from: fromStart, to: toEnd,
                startDOM: (fromI ? this.children[fromI - 1].dom.nextSibling : null) || this.dom.firstChild,
                endDOM: toI < this.children.length - 1 ? this.children[toI + 1].dom : null };
        };
        // FIXME track precise dirty ranges, to avoid full DOM sync on every touched node?
        ContentView.prototype.markDirty = function () {
            if (this.dirty & 2 /* node */)
                return;
            this.dirty |= 2 /* node */;
            this.markParentsDirty();
        };
        ContentView.prototype.markParentsDirty = function () {
            for (var parent_2 = this.parent; parent_2; parent_2 = parent_2.parent) {
                if (parent_2.dirty & 1 /* child */)
                    return;
                parent_2.dirty |= 1 /* child */;
            }
        };
        ContentView.prototype.setParent = function (parent) {
            if (this.parent != parent) {
                this.parent = parent;
                if (this.dirty)
                    this.markParentsDirty();
            }
        };
        ContentView.prototype.setDOM = function (dom) {
            this.dom = dom;
            dom.cmView = this;
        };
        Object.defineProperty(ContentView.prototype, "rootView", {
            get: function () {
                for (var v = this;;) {
                    var parent_3 = v.parent;
                    if (!parent_3)
                        return v;
                    v = parent_3;
                }
            },
            enumerable: true,
            configurable: true
        });
        ContentView.prototype.replaceChildren = function (from, to, children) {
            if (children === void 0) { children = none$1; }
            var _a;
            this.markDirty();
            for (var i = from; i < to; i++)
                this.children[i].parent = null;
            (_a = this.children).splice.apply(_a, [from, to - from].concat(children));
            for (var i = 0; i < children.length; i++)
                children[i].setParent(this);
        };
        ContentView.prototype.ignoreMutation = function (rec) { return false; };
        ContentView.prototype.ignoreEvent = function (event) { return false; };
        ContentView.prototype.childPos = function (pos, bias) {
            if (bias === void 0) { bias = 1; }
            return new ChildCursor(this.children, this.length, this.childGap).findPos(pos, bias);
        };
        ContentView.prototype.toString = function () {
            var name = this.constructor.name.replace("View", "");
            return name + (this.children.length ? "(" + this.children.join() + ")" :
                this.length ? "[" + (name == "Text" ? this.text : this.length) + "]" : "");
        };
        return ContentView;
    }());
    // Remove a DOM node and return its next sibling.
    function rm(dom) {
        var next = dom.nextSibling;
        dom.parentNode.removeChild(dom);
        return next;
    }
    function syncNodeInto(parent, pos, dom) {
        if (dom.parentNode == parent) {
            while (pos != dom)
                pos = rm(pos);
            pos = dom.nextSibling;
        }
        else {
            parent.insertBefore(dom, pos);
        }
        return pos;
    }
    var ChildCursor = /** @class */ (function () {
        function ChildCursor(children, pos, gap, i) {
            if (gap === void 0) { gap = 0; }
            if (i === void 0) { i = children.length; }
            this.children = children;
            this.pos = pos;
            this.gap = gap;
            this.i = i;
            this.off = 0;
            this.pos += gap;
        }
        ChildCursor.prototype.findPos = function (pos, bias) {
            if (bias === void 0) { bias = 1; }
            for (;;) {
                if (pos > this.pos || pos == this.pos && (bias > 0 || this.i == 0)) {
                    this.off = pos - this.pos;
                    return this;
                }
                this.pos -= this.children[--this.i].length + this.gap;
            }
        };
        return ChildCursor;
    }());

    var Range = /** @class */ (function () {
        function Range(from, to, value) {
            this.from = from;
            this.to = to;
            this.value = value;
        }
        /** @internal */
        Range.prototype.map = function (changes, oldOffset, newOffset) {
            var mapped = this.value.map(changes, this.from + oldOffset, this.to + oldOffset);
            if (mapped) {
                mapped.from -= newOffset;
                mapped.to -= newOffset;
            }
            return mapped;
        };
        /** @internal */
        Range.prototype.move = function (offset) {
            return offset ? new Range(this.from + offset, this.to + offset, this.value) : this;
        };
        Object.defineProperty(Range.prototype, "heapPos", {
            /** @internal Here so that we can put active ranges on a heap
             * and take them off at their end */
            get: function () { return this.to; },
            enumerable: true,
            configurable: true
        });
        return Range;
    }());
    var none$2 = [];
    function maybeNone(array) { return array.length ? array : none$2; }
    var BASE_NODE_SIZE_SHIFT = 5, BASE_NODE_SIZE = 1 << BASE_NODE_SIZE_SHIFT;
    var RangeSet = /** @class */ (function () {
        // @internal
        function RangeSet(
        // @internal The text length covered by this set
        length, 
        // The number of ranges in the set
        size, 
        // @internal The locally stored ranges—which are all of them
        // for leaf nodes, and the ones that don't fit in child sets for
        // non-leaves. Sorted by start position, then bias.
        local, 
        // @internal The child sets, in position order. Their total
        // length may be smaller than .length if the end is empty (never
        // greater)
        children) {
            this.length = length;
            this.size = size;
            this.local = local;
            this.children = children;
        }
        RangeSet.prototype.update = function (added, filter, filterFrom, filterTo) {
            if (added === void 0) { added = none$2; }
            if (filter === void 0) { filter = null; }
            if (filterFrom === void 0) { filterFrom = 0; }
            if (filterTo === void 0) { filterTo = this.length; }
            var maxLen = added.reduce(function (l, d) { return Math.max(l, d.to); }, this.length);
            return this.updateInner(added.length ? added.slice().sort(byPos) : added, filter, filterFrom, filterTo, 0, maxLen);
        };
        /** @internal */
        RangeSet.prototype.updateInner = function (added, filter, filterFrom, filterTo, offset, length) {
            // The new local ranges. Null means no changes were made yet
            var local = filterRanges(this.local, filter, filterFrom, filterTo, offset);
            // The new array of child sets, if changed
            var children = null;
            var size = 0;
            var decI = 0, pos = offset;
            // Iterate over the child sets, applying filters and pushing added
            // ranges into them
            for (var i = 0; i < this.children.length; i++) {
                var child = this.children[i];
                var endPos = pos + child.length, localRanges = null;
                while (decI < added.length) {
                    var next = added[decI];
                    if (next.from >= endPos)
                        break;
                    decI++;
                    if (next.to > endPos) {
                        if (!local)
                            local = this.local.slice();
                        insertSorted(local, next.move(-offset));
                    }
                    else {
                        (localRanges || (localRanges = [])).push(next);
                    }
                }
                var newChild = child;
                if (localRanges || filter && filterFrom <= endPos && filterTo >= pos)
                    newChild = newChild.updateInner(localRanges || none$2, filter, filterFrom, filterTo, pos, newChild.length);
                if (newChild != child)
                    (children || (children = this.children.slice(0, i))).push(newChild);
                else if (children)
                    children.push(newChild);
                size += newChild.size;
                pos = endPos;
            }
            // If nothing was actually updated, return the existing object
            if (!local && !children && decI == added.length)
                return this;
            // Compute final size
            size += (local || this.local).length + added.length - decI;
            // This is a small node—turn it into a flat leaf
            if (size <= BASE_NODE_SIZE)
                return collapseSet(children || this.children, local || this.local.slice(), added, decI, offset, length);
            var childSize = Math.max(BASE_NODE_SIZE, size >> BASE_NODE_SIZE_SHIFT);
            if (decI < added.length) {
                if (!children)
                    children = this.children.slice();
                if (!local)
                    local = this.local.slice();
                appendRanges(local, children, added, decI, offset, length, pos, childSize);
            }
            if (children) {
                if (!local)
                    local = this.local.slice();
                rebalanceChildren(local, children, childSize);
            }
            return new RangeSet(length, size, maybeNone(local || this.local), maybeNone(children || this.children));
        };
        RangeSet.prototype.grow = function (length) {
            return new RangeSet(this.length + length, this.size, this.local, this.children);
        };
        // Collect all ranges in this set into the target array,
        // offsetting them by `offset`
        RangeSet.prototype.collect = function (target, offset) {
            for (var _i = 0, _a = this.local; _i < _a.length; _i++) {
                var range = _a[_i];
                target.push(range.move(offset));
            }
            for (var _b = 0, _c = this.children; _b < _c.length; _b++) {
                var child = _c[_b];
                child.collect(target, offset);
                offset += child.length;
            }
        };
        RangeSet.prototype.map = function (changes) {
            if (changes.length == 0 || this == RangeSet.empty)
                return this;
            return this.mapInner(changes, 0, 0, changes.mapPos(this.length, 1)).set;
        };
        // Child boundaries are always mapped forward. This may cause ranges
        // at the start of a set to end up sticking out before its new
        // start, if they map backward. Such ranges are returned in
        // `escaped`.
        RangeSet.prototype.mapInner = function (changes, oldStart, newStart, newEnd) {
            var newLocal = null;
            var escaped = null;
            var newLength = newEnd - newStart, newSize = 0;
            for (var i = 0; i < this.local.length; i++) {
                var range = this.local[i], mapped = range.map(changes, oldStart, newStart);
                var escape_1 = mapped != null && (mapped.from < 0 || mapped.to > newLength);
                if (newLocal == null && (range != mapped || escape_1))
                    newLocal = this.local.slice(0, i);
                if (escape_1)
                    (escaped || (escaped = [])).push(mapped);
                else if (newLocal && mapped)
                    newLocal.push(mapped);
            }
            var newChildren = null;
            for (var i = 0, oldPos = oldStart, newPos = newStart; i < this.children.length; i++) {
                var child = this.children[i], newChild = child;
                var oldChildEnd = oldPos + child.length;
                var newChildEnd = changes.mapPos(oldPos + child.length, 1);
                var touch = touchesChanges(oldPos, oldChildEnd, changes.changes);
                if (touch == 0 /* yes */) {
                    var inner = child.mapInner(changes, oldPos, newPos, newChildEnd);
                    newChild = inner.set;
                    if (inner.escaped)
                        for (var _i = 0, _a = inner.escaped; _i < _a.length; _i++) {
                            var range = _a[_i];
                            range = range.move(newPos - newStart);
                            if (range.from < 0 || range.to > newLength)
                                insertSorted(escaped || (escaped = []), range);
                            else
                                insertSorted(newLocal || (newLocal = this.local.slice()), range);
                        }
                }
                else if (touch == 2 /* covered */) {
                    newChild = RangeSet.empty.grow(newChildEnd - newPos);
                }
                if (newChild != child) {
                    if (newChildren == null)
                        newChildren = this.children.slice(0, i);
                    // If the node's content was completely deleted by mapping,
                    // drop the node—which is complicated by the need to
                    // distribute its length to another child when it's not the
                    // last child
                    if (newChild.size == 0 && (newChild.length == 0 || newChildren.length || i == this.children.length)) {
                        if (newChild.length > 0 && i > 0) {
                            var last = newChildren.length - 1, lastChild = newChildren[last];
                            newChildren[last] = new RangeSet(lastChild.length + newChild.length, lastChild.size, lastChild.local, lastChild.children);
                        }
                    }
                    else {
                        newChildren.push(newChild);
                    }
                }
                else if (newChildren) {
                    newChildren.push(newChild);
                }
                newSize += newChild.size;
                oldPos = oldChildEnd;
                newPos = newChildEnd;
            }
            var set = newLength == this.length && newChildren == null && newLocal == null
                ? this
                : new RangeSet(newLength, newSize + (newLocal || this.local).length, newLocal || this.local, newChildren || this.children);
            return { set: set, escaped: escaped };
        };
        RangeSet.prototype.forEach = function (f) { this.forEachInner(f, 0); };
        RangeSet.prototype.forEachInner = function (f, offset) {
            for (var _i = 0, _a = this.local; _i < _a.length; _i++) {
                var range = _a[_i];
                f(range.from + offset, range.to + offset, range.value);
            }
            for (var _b = 0, _c = this.children; _b < _c.length; _b++) {
                var child = _c[_b];
                child.forEachInner(f, offset);
                offset += child.length;
            }
        };
        RangeSet.prototype.iter = function () {
            var heap = [];
            if (this.size > 0) {
                addIterToHeap(heap, [new IteratedSet(0, this)], 0);
                if (this.local.length)
                    addToHeap(heap, new LocalSet(0, this.local));
            }
            return {
                next: function () {
                    if (heap.length == 0)
                        return;
                    var next = takeFromHeap(heap);
                    if (next instanceof LocalSet) {
                        var range = next.ranges[next.index].move(next.offset);
                        // Put the rest of the set back onto the heap
                        if (++next.index < next.ranges.length)
                            addToHeap(heap, next);
                        else if (next.next)
                            addIterToHeap(heap, next.next, 0);
                        return range;
                    }
                    else { // It is a range
                        return next;
                    }
                }
            };
        };
        RangeSet.prototype.compare = function (other, textDiff, comparator, oldLen) {
            var oldPos = 0, newPos = 0;
            for (var _i = 0, textDiff_1 = textDiff; _i < textDiff_1.length; _i++) {
                var range = textDiff_1[_i];
                if (range.fromB > newPos && (this != other || oldPos != newPos))
                    new RangeSetComparison(this, oldPos, other, newPos, range.fromB, comparator).run();
                oldPos = range.toA;
                newPos = range.toB;
            }
            if (oldPos < this.length || newPos < other.length || textDiff.length == 0)
                new RangeSetComparison(this, oldPos, other, newPos, newPos + (oldLen - oldPos), comparator).run();
        };
        RangeSet.iterateSpans = function (sets, from, to, iterator) {
            var heap = [];
            for (var _i = 0, sets_1 = sets; _i < sets_1.length; _i++) {
                var set = sets_1[_i];
                if (set.size > 0) {
                    addIterToHeap(heap, [new IteratedSet(0, set)], from);
                    if (set.local.length)
                        addToHeap(heap, new LocalSet(0, set.local));
                }
            }
            var active = [];
            while (heap.length > 0) {
                var next = takeFromHeap(heap);
                if (next instanceof LocalSet) {
                    var range = next.ranges[next.index];
                    if (range.from + next.offset > to)
                        break;
                    if (range.to + next.offset >= from) {
                        if (range.from < range.to && !iterator.ignoreRange(range.value)) {
                            range = range.move(next.offset);
                            iterator.advance(range.from, active);
                            var collapsed = range.value.collapsed;
                            if (collapsed) {
                                from = range.to;
                                iterator.advanceCollapsed(Math.min(from, to), range.value);
                            }
                            else {
                                active.push(range.value);
                                addToHeap(heap, range);
                            }
                        }
                        else if (range.from == range.to && !iterator.ignorePoint(range.value)) {
                            iterator.advance(range.from, active);
                            iterator.point(range.value);
                        }
                    }
                    // Put the rest of the set back onto the heap
                    if (++next.index < next.ranges.length)
                        addToHeap(heap, next);
                    else if (next.next)
                        addIterToHeap(heap, next.next, from);
                }
                else { // It is a range that ends here
                    var range = next;
                    if (range.to >= to)
                        break;
                    iterator.advance(range.to, active);
                    active.splice(active.indexOf(range.value), 1);
                }
            }
            iterator.advance(to, active);
        };
        RangeSet.of = function (ranges) {
            return RangeSet.empty.update(ranges instanceof Range ? [ranges] : ranges);
        };
        RangeSet.empty = new RangeSet(0, 0, none$2, none$2);
        return RangeSet;
    }());
    // Stack element for iterating over a range set
    var IteratedSet = /** @class */ (function () {
        function IteratedSet(offset, set) {
            this.offset = offset;
            this.set = set;
            // Index == -1 means the set's locals have not been yielded yet.
            // Otherwise this is an index in the set's child array.
            this.index = 0;
        }
        return IteratedSet;
    }());
    // Cursor into a node-local set of ranges
    var LocalSet = /** @class */ (function () {
        function LocalSet(offset, ranges, next) {
            if (next === void 0) { next = null; }
            this.offset = offset;
            this.ranges = ranges;
            this.next = next;
            this.index = 0;
        }
        Object.defineProperty(LocalSet.prototype, "heapPos", {
            // Used to make this conform to Heapable
            get: function () { return this.ranges[this.index].from + this.offset; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(LocalSet.prototype, "value", {
            get: function () { return this.ranges[this.index].value; },
            enumerable: true,
            configurable: true
        });
        return LocalSet;
    }());
    function iterRangeSet(stack, skipTo) {
        if (skipTo === void 0) { skipTo = 0; }
        for (;;) {
            if (stack.length == 0)
                break;
            var top_1 = stack[stack.length - 1];
            if (top_1.index == top_1.set.children.length) {
                stack.pop();
            }
            else {
                var next = top_1.set.children[top_1.index], start = top_1.offset;
                top_1.index++;
                top_1.offset += next.length;
                if (top_1.offset >= skipTo) {
                    stack.push(new IteratedSet(start, next));
                    break;
                }
            }
        }
    }
    function compareHeapable(a, b) {
        return a.heapPos - b.heapPos || a.value.bias - b.value.bias;
    }
    function addIterToHeap(heap, stack, skipTo) {
        if (skipTo === void 0) { skipTo = 0; }
        for (;;) {
            iterRangeSet(stack, skipTo);
            if (stack.length == 0)
                break;
            var next = stack[stack.length - 1], local = next.set.local;
            var leaf = next.set.children.length ? null : stack;
            if (local.length)
                addToHeap(heap, new LocalSet(next.offset, local, leaf));
            if (leaf)
                break;
        }
    }
    function addToHeap(heap, elt) {
        var index = heap.push(elt) - 1;
        while (index > 0) {
            var parentIndex = index >> 1, parent_1 = heap[parentIndex];
            if (compareHeapable(elt, parent_1) >= 0)
                break;
            heap[index] = parent_1;
            heap[parentIndex] = elt;
            index = parentIndex;
        }
    }
    function takeFromHeap(heap) {
        var elt = heap[0], replacement = heap.pop();
        if (heap.length == 0)
            return elt;
        heap[0] = replacement;
        for (var index = 0;;) {
            var childIndex = (index << 1) + 1;
            if (childIndex >= heap.length)
                break;
            var child = heap[childIndex];
            if (childIndex + 1 < heap.length && compareHeapable(child, heap[childIndex + 1]) >= 0) {
                child = heap[childIndex + 1];
                childIndex++;
            }
            if (compareHeapable(replacement, child) < 0)
                break;
            heap[childIndex] = replacement;
            heap[index] = child;
            index = childIndex;
        }
        return elt;
    }
    function byPos(a, b) {
        return a.from - b.from || a.value.bias - b.value.bias;
    }
    function insertSorted(target, range) {
        var i = target.length;
        while (i > 0 && byPos(target[i - 1], range) >= 0)
            i--;
        target.splice(i, 0, range);
    }
    function filterRanges(ranges, filter, filterFrom, filterTo, offset) {
        if (!filter)
            return null;
        var copy = null;
        for (var i = 0; i < ranges.length; i++) {
            var range = ranges[i], from = range.from + offset, to = range.to + offset;
            if (filterFrom > to || filterTo < from || filter(from, to, range.value)) {
                if (copy != null)
                    copy.push(range);
            }
            else {
                if (copy == null)
                    copy = ranges.slice(0, i);
            }
        }
        return copy;
    }
    function collapseSet(children, local, add, start, offset, length) {
        var mustSort = local.length > 0 && add.length > 0, off = 0;
        for (var _i = 0, children_1 = children; _i < children_1.length; _i++) {
            var child = children_1[_i];
            child.collect(local, -off);
            off += child.length;
        }
        for (var _a = 0, add_1 = add; _a < add_1.length; _a++) {
            var added = add_1[_a];
            local.push(added.move(-offset));
        }
        if (mustSort)
            local.sort(byPos);
        return new RangeSet(length, local.length, local, none$2);
    }
    function appendRanges(local, children, ranges, start, offset, length, pos, childSize) {
        // Group added ranges after the current children into new
        // children (will usually only happen when initially creating a
        // node or adding stuff to the top-level node)
        for (var i = start; i < ranges.length;) {
            var add = [];
            var end = Math.min(i + childSize, ranges.length);
            var endPos = end == ranges.length ? offset + length : ranges[end].from;
            for (; i < end; i++) {
                var range = ranges[i];
                if (range.to > endPos)
                    insertSorted(local, range.move(-offset));
                else
                    add.push(range);
            }
            // Move locals that fit in this new child from `local` to `add`
            for (var i_1 = 0; i_1 < local.length; i_1++) {
                var range = local[i_1];
                if (range.from >= pos && range.to <= endPos) {
                    local.splice(i_1--, 1);
                    insertSorted(add, range.move(offset));
                }
            }
            if (add.length) {
                if (add.length == ranges.length)
                    children.push(new RangeSet(endPos - pos, add.length, add.map(function (r) { return r.move(-pos); }), none$2));
                else
                    children.push(RangeSet.empty.updateInner(add, null, 0, 0, pos, endPos - pos));
                pos = endPos;
            }
        }
    }
    // FIXME try to clean this up
    function rebalanceChildren(local, children, childSize) {
        var _loop_1 = function (i, off) {
            var child = children[i], next = void 0;
            if (child.size == 0 && (i > 0 || children.length == 1)) {
                // Drop empty node
                children.splice(i--, 1);
                if (i >= 0)
                    children[i] = children[i].grow(child.length);
            }
            else if (child.size > (childSize << 1) && child.local.length < (child.length >> 1)) {
                // Unwrap an overly big node
                for (var _i = 0, _a = child.local; _i < _a.length; _i++) {
                    var range = _a[_i];
                    insertSorted(local, range.move(off));
                }
                children.splice.apply(children, [i, 1].concat(child.children));
            }
            else if (child.children.length == 0 && i < children.length - 1 &&
                (next = children[i + 1]).size + child.size <= BASE_NODE_SIZE &&
                next.children.length == 0) {
                // Join two small leaf nodes
                children.splice(i, 2, new RangeSet(child.length + next.length, child.size + next.size, child.local.concat(next.local.map(function (d) { return d.move(child.length); })), none$2));
            }
            else {
                // Join a number of nodes into a wrapper node
                var joinTo = i + 1, size = child.size, length_1 = child.length;
                if (child.size < (childSize >> 1)) {
                    for (; joinTo < children.length; joinTo++) {
                        var next_1 = children[joinTo], totalSize = size + next_1.size;
                        if (totalSize > childSize)
                            break;
                        size = totalSize;
                        length_1 += next_1.length;
                    }
                }
                if (joinTo > i + 1) {
                    var joined = new RangeSet(length_1, size, none$2, children.slice(i, joinTo));
                    var joinedLocals = [];
                    for (var j = 0; j < local.length; j++) {
                        var range = local[j];
                        if (range.from >= off && range.to <= off + length_1) {
                            local.splice(j--, 1);
                            joinedLocals.push(range.move(-off));
                        }
                    }
                    if (joinedLocals.length)
                        joined = joined.update(joinedLocals.sort(byPos));
                    children.splice(i, joinTo - i, joined);
                    i++;
                    off += length_1;
                }
                else {
                    i++;
                    off += child.length;
                }
            }
            out_i_1 = i;
            out_off_1 = off;
        };
        var out_i_1, out_off_1;
        for (var i = 0, off = 0; i < children.length;) {
            _loop_1(i, off);
            i = out_i_1;
            off = out_off_1;
        }
    }
    var SIDE_A = 1, SIDE_B = 2;
    var ComparisonSide = /** @class */ (function () {
        function ComparisonSide(stack) {
            this.stack = stack;
            this.heap = [];
            this.active = [];
            this.activeTo = [];
            this.points = [];
            this.tip = null;
            this.collapsedBy = null;
            this.collapsedTo = -1;
        }
        ComparisonSide.prototype.forward = function (start, next) {
            var newTip = false;
            if (next.set.local.length) {
                var local = new LocalSet(next.offset, next.set.local);
                addToHeap(this.heap, local);
                if (!next.set.children.length) {
                    this.tip = local;
                    newTip = true;
                }
            }
            iterRangeSet(this.stack, start);
            return newTip;
        };
        ComparisonSide.prototype.findActive = function (to, value) {
            for (var i = 0; i < this.active.length; i++)
                if (this.activeTo[i] == to && this.active[i] == value)
                    return i;
            return -1;
        };
        return ComparisonSide;
    }());
    var RangeSetComparison = /** @class */ (function () {
        function RangeSetComparison(a, startA, b, startB, endB, comparator) {
            this.comparator = comparator;
            this.a = new ComparisonSide([new IteratedSet(startB - startA, a)]);
            this.b = new ComparisonSide([new IteratedSet(0, b)]);
            this.pos = startB;
            this.end = endB;
            this.forwardIter(SIDE_A | SIDE_B);
        }
        RangeSetComparison.prototype.forwardIter = function (side) {
            for (; side > 0;) {
                var nextA = this.a.stack.length ? this.a.stack[this.a.stack.length - 1] : null;
                var nextB = this.b.stack.length ? this.b.stack[this.b.stack.length - 1] : null;
                if (nextA && nextB && nextA.offset == nextB.offset && nextA.set == nextB.set) {
                    iterRangeSet(this.a.stack, this.pos);
                    iterRangeSet(this.b.stack, this.pos);
                }
                else if (nextA && (!nextB || (nextA.offset < nextB.offset ||
                    nextA.offset == nextB.offset && (this.a.stack.length == 1 ||
                        nextA.set.length >= nextB.set.length)))) {
                    if (this.a.forward(this.pos, nextA))
                        side = side & ~SIDE_A;
                }
                else if (nextB) {
                    if (this.b.forward(this.pos, nextB))
                        side = side & ~SIDE_B;
                }
                else {
                    break;
                }
            }
        };
        RangeSetComparison.prototype.run = function () {
            var heapA = this.a.heap, heapB = this.b.heap;
            for (;;) {
                if (heapA.length && (!heapB.length || compareHeapable(heapA[0], heapB[0]) < 0)) {
                    this.advance(this.a, this.b);
                }
                else if (heapB.length) {
                    this.advance(this.b, this.a);
                }
                else {
                    this.comparator.comparePoints(this.pos, this.a.points, this.b.points);
                    break;
                }
            }
        };
        RangeSetComparison.prototype.advancePos = function (pos) {
            if (pos > this.end)
                pos = this.end;
            if (pos <= this.pos)
                return;
            this.handlePoints();
            this.comparator.compareRange(this.pos, pos, this.a.active, this.b.active);
            this.pos = pos;
        };
        RangeSetComparison.prototype.handlePoints = function () {
            if (this.a.points.length || this.b.points.length) {
                this.comparator.comparePoints(this.pos, this.a.points, this.b.points);
                this.a.points.length = this.b.points.length = 0;
            }
        };
        RangeSetComparison.prototype.advance = function (side, otherSide) {
            var next = takeFromHeap(side.heap);
            if (next instanceof LocalSet) {
                var range = next.ranges[next.index++];
                if (range.from + next.offset > this.end) {
                    side.heap.length = 0;
                    this.pos = this.end;
                    return;
                }
                if (range.from < range.to && range.to + next.offset > this.pos) {
                    this.advancePos(range.from + next.offset);
                    var collapsed = range.value.collapsed;
                    if (collapsed) {
                        side.collapsedBy = range.value;
                        side.collapsedTo = Math.max(side.collapsedTo, range.to + next.offset);
                        // Skip regions that are collapsed on both sides
                        var collapsedTo = Math.min(this.a.collapsedTo, this.b.collapsedTo);
                        if (collapsedTo > this.pos) {
                            this.handlePoints();
                            this.comparator.compareCollapsed(this.pos, collapsedTo, this.a.collapsedBy, this.b.collapsedBy);
                            this.pos = collapsedTo;
                        }
                    }
                    this.addActiveRange(Math.min(this.end, range.to + next.offset), range.value, side, otherSide);
                }
                else if (range.from == range.to) {
                    this.advancePos(range.from + next.offset);
                    var found = otherSide.points.indexOf(range.value);
                    if (found > -1)
                        remove(otherSide.points, found);
                    else
                        side.points.push(range.value);
                }
                if (next.index < next.ranges.length)
                    addToHeap(side.heap, next);
                else if (next == this.a.tip)
                    this.forwardIter(SIDE_A);
                else if (next == this.b.tip)
                    this.forwardIter(SIDE_B);
            }
            else {
                var range = next;
                this.advancePos(range.to);
                var found = side.findActive(range.to, range.value);
                if (found > -1) {
                    remove(side.active, found);
                    remove(side.activeTo, found);
                }
            }
        };
        RangeSetComparison.prototype.addActiveRange = function (to, value, side, otherSide) {
            var found = otherSide.findActive(to, value);
            if (found > -1) {
                remove(otherSide.active, found);
                remove(otherSide.activeTo, found);
            }
            else {
                side.active.push(value);
                side.activeTo.push(to);
                addToHeap(side.heap, new Range(this.pos, to, value));
            }
        };
        return RangeSetComparison;
    }());
    function remove(array, index) {
        var last = array.pop();
        if (index != array.length)
            array[index] = last;
    }
    function touchesChanges(from, to, changes) {
        var result = 1 /* no */;
        for (var _i = 0, changes_1 = changes; _i < changes_1.length; _i++) {
            var change = changes_1[_i];
            if (change.to >= from && change.from <= to) {
                if (change.from < from && change.to > to)
                    result = 2 /* covered */;
                else if (result == 1 /* no */)
                    result = 0 /* yes */;
            }
            var diff = change.length - (change.to - change.from);
            if (from > change.from)
                from += diff;
            if (to > change.to)
                to += diff;
        }
        return result;
    }

    function combineAttrs(source, target) {
        for (var name_1 in source) {
            if (name_1 == "class" && target.class)
                target.class += " " + source.class;
            else if (name_1 == "style" && target.style)
                target.style += ";" + source.style;
            else
                target[name_1] = source[name_1];
        }
        return target;
    }
    function attrsEq(a, b) {
        if (a == b)
            return true;
        if (!a || !b)
            return false;
        var keysA = Object.keys(a), keysB = Object.keys(b);
        if (keysA.length != keysB.length)
            return false;
        for (var _i = 0, keysA_1 = keysA; _i < keysA_1.length; _i++) {
            var key = keysA_1[_i];
            if (keysB.indexOf(key) == -1 || a[key] !== b[key])
                return false;
        }
        return true;
    }
    function updateAttrs(dom, prev, attrs) {
        if (prev)
            for (var name_2 in prev)
                if (!(attrs && name_2 in attrs))
                    dom.removeAttribute(name_2);
        if (attrs)
            for (var name_3 in attrs)
                if (!(prev && prev[name_3] == attrs[name_3]))
                    dom.setAttribute(name_3, attrs[name_3]);
    }

    var WidgetType = /** @class */ (function () {
        function WidgetType(value) {
            this.value = value;
        }
        WidgetType.prototype.eq = function (value) { return this.value === value; };
        /** @internal */
        WidgetType.prototype.compare = function (other) {
            return this == other || this.constructor == other.constructor && this.eq(other.value);
        };
        Object.defineProperty(WidgetType.prototype, "estimatedHeight", {
            get: function () { return -1; },
            enumerable: true,
            configurable: true
        });
        WidgetType.prototype.ignoreEvent = function (event) { return true; };
        return WidgetType;
    }());
    var Decoration = /** @class */ (function () {
        // @internal
        function Decoration(
        // @internal
        bias, 
        // @internal
        widget, spec) {
            this.bias = bias;
            this.widget = widget;
            this.spec = spec;
        }
        Decoration.range = function (from, to, spec) {
            if (from >= to)
                throw new RangeError("Range decorations may not be empty");
            return new Range(from, to, new RangeDecoration(spec));
        };
        Decoration.widget = function (pos, spec) {
            return new Range(pos, pos, new WidgetDecoration(spec));
        };
        Decoration.line = function (pos, spec) {
            return new Range(pos, pos, new LineDecoration(spec));
        };
        Decoration.set = function (of) {
            return RangeSet.of(of);
        };
        Decoration.none = RangeSet.empty;
        return Decoration;
    }());
    var BIG_BIAS = 2e9;
    var RangeDecoration = /** @class */ (function (_super) {
        __extends(RangeDecoration, _super);
        function RangeDecoration(spec) {
            var _this = _super.call(this, spec.inclusiveStart === true ? -BIG_BIAS : BIG_BIAS, spec.collapsed instanceof WidgetType ? spec.collapsed : null, spec) || this;
            _this.spec = spec;
            _this.endBias = spec.inclusiveEnd == true ? BIG_BIAS : -BIG_BIAS;
            _this.collapsed = !!spec.collapsed;
            return _this;
        }
        RangeDecoration.prototype.map = function (mapping, from, to) {
            var newFrom = mapping.mapPos(from, this.bias, true), newTo = mapping.mapPos(to, this.endBias, true);
            if (newFrom < 0) {
                if (newTo < 0)
                    return null;
                newFrom = this.bias >= 0 ? -(newFrom + 1) : mapping.mapPos(from, 1);
            }
            else if (newTo < 0) {
                newTo = this.endBias < 0 ? -(newTo + 1) : mapping.mapPos(to, -1);
            }
            return newFrom < newTo ? new Range(newFrom, newTo, this) : null;
        };
        RangeDecoration.prototype.sameEffect = function (other) {
            return this == other ||
                this.spec.tagName == other.spec.tagName &&
                    this.spec.class == other.spec.class &&
                    this.collapsed == other.collapsed &&
                    widgetsEq(this.widget, other.widget) &&
                    attrsEq(this.spec.attributes || null, other.spec.attributes || null);
        };
        return RangeDecoration;
    }(Decoration));
    var WidgetDecoration = /** @class */ (function (_super) {
        __extends(WidgetDecoration, _super);
        function WidgetDecoration(spec) {
            var _this = _super.call(this, spec.side || 0, spec.widget || null, spec) || this;
            _this.spec = spec;
            return _this;
        }
        WidgetDecoration.prototype.map = function (mapping, pos) {
            pos = mapping.mapPos(pos, this.bias, true);
            return pos < 0 ? null : new Range(pos, pos, this);
        };
        WidgetDecoration.prototype.sameEffect = function (other) {
            return other instanceof WidgetDecoration && widgetsEq(this.widget, other.widget) && this.bias == other.bias;
        };
        return WidgetDecoration;
    }(Decoration));
    var LineDecoration = /** @class */ (function (_super) {
        __extends(LineDecoration, _super);
        function LineDecoration(spec) {
            return _super.call(this, -BIG_BIAS, spec.widget || null, spec) || this;
        }
        LineDecoration.prototype.map = function (mapping, pos) {
            for (var _i = 0, _a = mapping.changes; _i < _a.length; _i++) {
                var change = _a[_i];
                // If the line break before was deleted, drop this decoration
                if (change.from <= pos - 1 && change.to >= pos)
                    return null;
                if (change.from < pos)
                    pos += change.length - (change.to - change.from);
            }
            return new Range(pos, pos, this);
        };
        LineDecoration.prototype.sameEffect = function (other) {
            return other instanceof LineDecoration &&
                attrsEq(this.spec.attributes, other.spec.attributes) &&
                widgetsEq(this.widget, other.widget) &&
                this.side == other.side;
        };
        Object.defineProperty(LineDecoration.prototype, "side", {
            get: function () { return this.spec.side || 0; },
            enumerable: true,
            configurable: true
        });
        return LineDecoration;
    }(Decoration));
    function widgetsEq(a, b) {
        return a == b || !!(a && b && a.compare(b));
    }
    function compareSets(setA, setB) {
        if (setA.length != setB.length)
            return false;
        search: for (var _i = 0, setA_1 = setA; _i < setA_1.length; _i++) {
            var value = setA_1[_i];
            for (var _a = 0, setB_1 = setB; _a < setB_1.length; _a++) {
                var valueB = setB_1[_a];
                if (value.sameEffect(valueB))
                    continue search;
            }
            return false;
        }
        return true;
    }
    var MIN_RANGE_GAP = 4;
    function addRange(from, to, ranges) {
        if (ranges[ranges.length - 1] + MIN_RANGE_GAP > from)
            ranges[ranges.length - 1] = to;
        else
            ranges.push(from, to);
    }
    function joinRanges(a, b) {
        if (a.length == 0)
            return b;
        if (b.length == 0)
            return a;
        var result = [];
        for (var iA = 0, iB = 0;;) {
            if (iA < a.length && (iB == b.length || a[iA] < b[iB]))
                addRange(a[iA++], a[iA++], result);
            else if (iB < b.length)
                addRange(b[iB++], b[iB++], result);
            else
                break;
        }
        return result;
    }
    var Changes = /** @class */ (function () {
        function Changes() {
            this.content = [];
            this.height = [];
        }
        return Changes;
    }());
    var DecorationComparator = /** @class */ (function () {
        function DecorationComparator() {
            this.changes = new Changes;
        }
        DecorationComparator.prototype.compareRange = function (from, to, activeA, activeB) {
            if (!compareSets(activeA, activeB))
                addRange(from, to, this.changes.content);
        };
        DecorationComparator.prototype.compareCollapsed = function (from, to, byA, byB) {
            if (!widgetsEq(byA.widget, byB.widget)) {
                addRange(from, to, this.changes.content);
                addRange(from, to, this.changes.height);
            }
        };
        DecorationComparator.prototype.comparePoints = function (pos, pointsA, pointsB) {
            if (!compareSets(pointsA, pointsB)) {
                addRange(pos, pos, this.changes.content);
                if (pointsA.some(function (d) { return !!(d.widget && d.widget.estimatedHeight > -1); }) ||
                    pointsB.some(function (d) { return !!(d.widget && d.widget.estimatedHeight > -1); }))
                    addRange(pos, pos, this.changes.height);
            }
        };
        return DecorationComparator;
    }());
    function findChangedRanges(a, b, diff, docA) {
        var comp = new DecorationComparator();
        a.compare(b, diff, comp, docA.length);
        return comp.changes;
    }
    var HeightDecoScanner = /** @class */ (function () {
        function HeightDecoScanner() {
            this.ranges = [];
            this.pos = 0;
        }
        HeightDecoScanner.prototype.advance = function (pos, active) { this.pos = pos; };
        HeightDecoScanner.prototype.advanceCollapsed = function (pos) { addRange(this.pos, pos, this.ranges); this.pos = pos; };
        HeightDecoScanner.prototype.point = function (value) { addRange(this.pos, this.pos, this.ranges); };
        HeightDecoScanner.prototype.ignoreRange = function (value) { return true; };
        HeightDecoScanner.prototype.ignorePoint = function (value) { return !value.widget; };
        return HeightDecoScanner;
    }());
    function heightRelevantDecorations(decorations, ranges) {
        var scanner = new HeightDecoScanner;
        for (var _i = 0, ranges_1 = ranges; _i < ranges_1.length; _i++) {
            var _a = ranges_1[_i], fromB = _a.fromB, toB = _a.toB;
            if (fromB < toB) {
                scanner.pos = fromB;
                RangeSet.iterateSpans(decorations, fromB, toB, scanner);
            }
        }
        return scanner.ranges;
    }

    var none$3 = [];
    var InlineView = /** @class */ (function (_super) {
        __extends(InlineView, _super);
        function InlineView() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        InlineView.prototype.merge = function (other, from, to) { return false; };
        InlineView.prototype.match = function (other) { return false; };
        Object.defineProperty(InlineView.prototype, "children", {
            get: function () { return none$3; },
            enumerable: true,
            configurable: true
        });
        InlineView.prototype.getSide = function () { return 0; };
        InlineView.appendInline = function (a, b) {
            var i = 0;
            if (b.length && a.length) {
                var last = a[a.length - 1];
                if (last.merge(b[0], last.length))
                    i++;
            }
            for (; i < b.length; i++)
                a.push(b[i]);
            return a;
        };
        return InlineView;
    }(ContentView));
    var MAX_JOIN_LEN = 256;
    var TextView = /** @class */ (function (_super) {
        __extends(TextView, _super);
        function TextView(text, tagName, clss, attrs) {
            var _this = _super.call(this) || this;
            _this.text = text;
            _this.tagName = tagName;
            _this.attrs = attrs;
            _this.textDOM = null;
            _this.class = clss;
            return _this;
        }
        TextView.prototype.syncInto = function (parent, pos) {
            if (!this.dom) {
                var tagName = this.tagName || (this.attrs || this.class ? "span" : null);
                if (!tagName && pos && pos.nodeType == 3 && !nodeAlreadyInTree(this, pos))
                    this.textDOM = pos;
                else
                    this.textDOM = document.createTextNode(this.text);
                if (tagName) {
                    var dom = document.createElement(tagName);
                    dom.appendChild(this.textDOM);
                    if (this.class)
                        dom.className = this.class;
                    if (this.attrs)
                        for (var name_1 in this.attrs)
                            dom.setAttribute(name_1, this.attrs[name_1]);
                    this.setDOM(dom);
                }
                else {
                    this.setDOM(this.textDOM);
                }
            }
            return _super.prototype.syncInto.call(this, parent, pos);
        };
        Object.defineProperty(TextView.prototype, "length", {
            get: function () { return this.text.length; },
            enumerable: true,
            configurable: true
        });
        TextView.prototype.sync = function () {
            if (this.dirty & 2 /* node */) {
                if (this.textDOM.nodeValue != this.text)
                    this.textDOM.nodeValue = this.text;
                var dom = this.dom;
                if (this.textDOM != dom && (this.dom.firstChild != this.textDOM || dom.lastChild != this.textDOM)) {
                    while (dom.firstChild)
                        dom.removeChild(dom.firstChild);
                    dom.appendChild(this.textDOM);
                }
            }
            this.dirty = 0 /* not */;
        };
        TextView.prototype.merge = function (other, from, to) {
            if (from === void 0) { from = 0; }
            if (to === void 0) { to = this.length; }
            if (!(other instanceof TextView) ||
                other.tagName != this.tagName || other.class != this.class ||
                !attrsEq(other.attrs, this.attrs) || this.length - (to - from) + other.length > MAX_JOIN_LEN)
                return false;
            this.text = this.text.slice(0, from) + other.text + this.text.slice(to);
            this.markDirty();
            return true;
        };
        TextView.prototype.cut = function (from, to) {
            if (to === void 0) { to = this.length; }
            this.text = this.text.slice(0, from) + this.text.slice(to);
            this.markDirty();
        };
        TextView.prototype.slice = function (from, to) {
            if (to === void 0) { to = this.length; }
            return new TextView(this.text.slice(from, to), this.tagName, this.class, this.attrs);
        };
        TextView.prototype.localPosFromDOM = function (node, offset) {
            return node == this.textDOM ? offset : offset ? this.text.length : 0;
        };
        TextView.prototype.domFromPos = function (pos) { return { node: this.textDOM, offset: pos }; };
        TextView.prototype.domBoundsAround = function (from, to, offset) {
            return { from: offset, to: offset + this.length, startDOM: this.dom, endDOM: this.dom.nextSibling };
        };
        TextView.prototype.coordsAt = function (pos) { return textCoords(this.textDOM, pos); };
        TextView.prototype.toCompositionView = function () {
            var parent = this.parent, view = new CompositionView(this.dom, this.textDOM, this.length);
            this.markParentsDirty();
            var parentIndex = parent.children.indexOf(this);
            parent.children[parentIndex] = view;
            view.setParent(parent);
            return view;
        };
        return TextView;
    }(InlineView));
    function textCoords(text, pos) {
        var range = document.createRange();
        if (browser.chrome || browser.gecko) {
            // These browsers reliably return valid rectangles for empty ranges
            range.setEnd(text, pos);
            range.setStart(text, pos);
            return range.getBoundingClientRect();
        }
        else {
            // Otherwise, get the rectangle around a character and take one side
            var extend = pos == 0 ? 1 : -1;
            range.setEnd(text, pos + (extend > 0 ? 1 : 0));
            range.setStart(text, pos - (extend < 0 ? 1 : 0));
            var rect = range.getBoundingClientRect();
            var x = extend < 0 ? rect.right : rect.left;
            return { left: x, right: x, top: rect.top, bottom: rect.bottom };
        }
    }
    // Also used for collapsed ranges that don't have a placeholder widget!
    var WidgetView = /** @class */ (function (_super) {
        __extends(WidgetView, _super);
        function WidgetView(length, widget, side) {
            var _this = _super.call(this) || this;
            _this.length = length;
            _this.widget = widget;
            _this.side = side;
            return _this;
        }
        WidgetView.prototype.syncInto = function (parent, pos) {
            if (!this.dom) {
                this.setDOM(this.widget ? this.widget.toDOM() : document.createElement("span"));
                this.dom.contentEditable = "false";
            }
            return _super.prototype.syncInto.call(this, parent, pos);
        };
        WidgetView.prototype.cut = function (from, to) {
            if (to === void 0) { to = this.length; }
            this.length -= to - from;
        };
        WidgetView.prototype.slice = function (from, to) {
            if (to === void 0) { to = this.length; }
            return new WidgetView(to - from, this.widget, this.side);
        };
        WidgetView.prototype.sync = function () { this.dirty = 0 /* not */; };
        WidgetView.prototype.getSide = function () { return this.side; };
        WidgetView.prototype.merge = function (other, from, to) {
            if (from === void 0) { from = 0; }
            if (to === void 0) { to = this.length; }
            if (!(other instanceof WidgetView) || this.widget || other.widget)
                return false;
            this.length = from + other.length + (this.length - to);
            return true;
        };
        WidgetView.prototype.match = function (other) {
            return other.length == this.length && other instanceof WidgetView &&
                widgetsEq(this.widget, other.widget);
        };
        WidgetView.prototype.ignoreMutation = function () { return true; };
        WidgetView.prototype.ignoreEvent = function (event) { return this.widget ? this.widget.ignoreEvent(event) : false; };
        Object.defineProperty(WidgetView.prototype, "overrideDOMText", {
            get: function () {
                if (this.length == 0)
                    return [""];
                var top = this;
                while (top.parent)
                    top = top.parent;
                var state = top.state, text = state && state.doc, start = this.posAtStart;
                return text ? text.sliceLines(start, start + this.length) : [""];
            },
            enumerable: true,
            configurable: true
        });
        WidgetView.prototype.domBoundsAround = function () { return null; };
        WidgetView.prototype.coordsAt = function (pos) {
            var rects = this.dom.getClientRects();
            for (var i = pos > 0 ? rects.length - 1 : 0;; i += (pos > 0 ? -1 : 1)) {
                var rect = rects[i];
                if (pos > 0 ? i == 0 : i == rects.length - 1 || rect.top < rect.bottom)
                    return rects[i];
            }
            return null;
        };
        return WidgetView;
    }(InlineView));
    var CompositionView = /** @class */ (function (_super) {
        __extends(CompositionView, _super);
        function CompositionView(dom, textDOM, length) {
            var _this = _super.call(this) || this;
            _this.textDOM = textDOM;
            _this.length = length;
            _this.setDOM(dom);
            return _this;
        }
        CompositionView.prototype.updateLength = function (newLen) {
            if (this.parent)
                this.parent.length += newLen - this.length;
            this.length = newLen;
        };
        CompositionView.prototype.cut = function (from, to) {
            if (to === void 0) { to = this.length; }
            if (from != to || from > 0 && from < this.length)
                throw new Error("bug: Cutting a composition node");
        };
        CompositionView.prototype.slice = function (from, to) {
            if (to === void 0) { to = this.length; }
            throw new Error("bug: Called slice on a composition node");
        };
        CompositionView.prototype.sync = function () { };
        CompositionView.prototype.localPosFromDOM = function (node, offset) {
            return node == this.textDOM ? offset : offset ? this.length : 0;
        };
        CompositionView.prototype.domFromPos = function (pos) { return { node: this.textDOM, offset: pos }; };
        CompositionView.prototype.domBoundsAround = function (from, to, offset) {
            return { from: offset, to: offset + this.length, startDOM: this.dom, endDOM: this.dom.nextSibling };
        };
        CompositionView.prototype.coordsAt = function (pos) { return textCoords(this.textDOM, pos); };
        return CompositionView;
    }(InlineView));
    function nodeAlreadyInTree(view, node) {
        var v = node.cmView;
        return v ? v.rootView == view.rootView : false;
    }

    var LineView = /** @class */ (function (_super) {
        __extends(LineView, _super);
        function LineView() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.children = [];
            _this.widgets = none$4;
            _this.length = 0;
            _this.prevAttrs = undefined;
            _this.attrs = null;
            return _this;
        }
        // Consumes source
        LineView.prototype.merge = function (from, to, source, takeDeco, composition) {
            if (to === void 0) { to = this.length; }
            if (takeDeco)
                this.setDeco(source);
            if (!this.dom)
                source.transferDOM(this); // Reuse source.dom when appropriate
            var elts = source.children;
            var cur = new ChildCursor(this.children, this.length);
            var _a = cur.findPos(to, 1), toI = _a.i, toOff = _a.off;
            var _b = cur.findPos(from, -1), fromI = _b.i, fromOff = _b.off;
            var dLen = from - to;
            for (var _i = 0, elts_1 = elts; _i < elts_1.length; _i++) {
                var view = elts_1[_i];
                dLen += view.length;
            }
            this.length += dLen;
            // Both from and to point into the same text view
            if (fromI == toI && fromOff) {
                var start = this.children[fromI];
                // Maybe just update that view and be done
                if (elts.length == 1 && start.merge(elts[0], fromOff, toOff))
                    return;
                if (elts.length == 0)
                    return start.cut(fromOff, toOff);
                // Otherwise split it, so that we don't have to worry about aliasting front/end afterwards
                InlineView.appendInline(elts, [start.slice(toOff)]);
                toI++;
                toOff = 0;
            }
            // Make sure start and end positions fall on node boundaries
            // (fromOff/toOff are no longer used after this), and that if the
            // start or end of the elts can be merged with adjacent nodes,
            // this is done
            if (toOff) {
                var end = this.children[toI];
                if (elts.length && end.merge(elts[elts.length - 1], 0, toOff))
                    elts.pop();
                else
                    end.cut(0, toOff);
            }
            else if (toI < this.children.length && elts.length &&
                this.children[toI].merge(elts[elts.length - 1], 0, 0)) {
                elts.pop();
            }
            if (fromOff) {
                var start = this.children[fromI];
                if (elts.length && start.merge(elts[0], fromOff))
                    elts.shift();
                else
                    start.cut(fromOff);
                fromI++;
            }
            else if (fromI && elts.length && this.children[fromI - 1].merge(elts[0], this.children[fromI - 1].length)) {
                elts.shift();
            }
            // Then try to merge any mergeable nodes at the start and end of
            // the changed range
            while (fromI < toI && elts.length && this.children[toI - 1].match(elts[elts.length - 1])) {
                elts.pop();
                toI--;
            }
            while (fromI < toI && elts.length && this.children[fromI].match(elts[0])) {
                elts.shift();
                fromI++;
            }
            if (composition && fromI < toI) {
                // If there's a zero-length composition on the edge of the update, don't overwrite it
                if (this.children[toI - 1] instanceof CompositionView && this.children[toI - 1].length == 0)
                    toI--;
                else if (this.children[fromI] instanceof CompositionView && this.children[fromI].length == 0)
                    fromI++;
            }
            // And if anything remains, splice the child array to insert the new elts
            if (elts.length || fromI != toI)
                this.replaceChildren(fromI, toI, elts);
        };
        LineView.prototype.split = function (at) {
            var end = new LineView;
            if (this.length == 0)
                return end;
            var _a = new ChildCursor(this.children, this.length).findPos(at), i = _a.i, off = _a.off;
            if (off) {
                end.append(this.children[i].slice(off));
                this.children[i].cut(off);
                i++;
            }
            for (var j = i; j < this.children.length; j++)
                end.append(this.children[j]);
            this.children.length = i;
            this.markDirty();
            this.length = at;
            return end;
        };
        LineView.prototype.transferDOM = function (other) {
            if (!this.dom)
                return;
            other.setDOM(this.dom);
            other.prevAttrs = this.prevAttrs === undefined ? this.attrs : this.prevAttrs;
            this.prevAttrs = undefined;
            this.dom = null;
        };
        LineView.prototype.setDeco = function (source) {
            if (!attrsEq(this.attrs, source.attrs)) {
                if (this.dom) {
                    this.prevAttrs = this.attrs;
                    this.markDirty();
                }
                this.attrs = source.attrs;
            }
            // Reconcile the new widgets with the existing ones
            for (var i = 0, j = 0;;) {
                var a = i == this.widgets.length ? null : this.widgets[i];
                var b = j == source.widgets.length ? null : source.widgets[j];
                if (!a && !b)
                    break;
                if (a && b && a.eq(b)) {
                    i++;
                    j++;
                }
                else if (!a || (b && b.side <= a.side)) {
                    if (this.widgets == none$4)
                        this.widgets = [];
                    this.widgets.splice(i++, 0, b.finish());
                    this.parent.markDirty();
                    j++;
                }
                else {
                    this.widgets.splice(i, 1);
                    this.parent.markDirty();
                }
            }
        };
        // Only called when building a line view in ContentBuilder
        LineView.prototype.append = function (child) {
            this.children.push(child);
            child.setParent(this);
            this.length += child.length;
        };
        // Only called when building a line view in ContentBuilder
        LineView.prototype.addLineDeco = function (deco) {
            var attrs = deco.spec.attributes;
            if (attrs)
                this.attrs = combineAttrs(attrs, this.attrs || {});
            if (deco.widget) {
                if (this.widgets == none$4)
                    this.widgets = [];
                var pos = 0;
                while (pos < this.widgets.length && this.widgets[pos].side <= deco.side)
                    pos++;
                this.widgets.splice(pos, 0, new LineWidget(deco.widget, deco.side));
            }
        };
        LineView.prototype.domFromPos = function (pos) {
            var _a = new ChildCursor(this.children, this.length).findPos(pos), i = _a.i, off = _a.off;
            if (off) {
                var textDOM = this.children[i].textDOM;
                if (textDOM)
                    return { node: textDOM, offset: off };
            }
            while (i > 0 && (this.children[i - 1].getSide() > 0 || this.children[i - 1].dom.parentNode != this.dom))
                i--;
            return { node: this.dom, offset: i ? domIndex(this.children[i - 1].dom) + 1 : 0 };
        };
        LineView.prototype.syncInto = function (parent, pos) {
            if (!this.dom) {
                this.setDOM(document.createElement("div"));
                this.dom.className = "codemirror-line";
                if (this.attrs)
                    this.prevAttrs = null;
                for (var _i = 0, _a = this.widgets; _i < _a.length; _i++) {
                    var w = _a[_i];
                    if (!w.dom)
                        w.finish();
                }
            }
            for (var i = 0, main = false;; i++) {
                var widget = i == this.widgets.length ? null : this.widgets[i];
                if (!main && (!widget || widget.side > 0)) {
                    main = true;
                    pos = syncNodeInto(parent, pos, this.dom);
                }
                if (!widget)
                    break;
                pos = syncNodeInto(parent, pos, widget.dom);
            }
            return pos;
        };
        // FIXME might need another hack to work around Firefox's behavior
        // of not actually displaying the cursor even though it's there in
        // the DOM
        LineView.prototype.sync = function () {
            _super.prototype.sync.call(this);
            if (this.prevAttrs !== undefined) {
                updateAttrs(this.dom, this.prevAttrs, this.attrs);
                this.dom.classList.add("codemirror-line");
                this.prevAttrs = undefined;
            }
            var last = this.dom.lastChild;
            if (!last || last.nodeName == "BR") {
                var hack = document.createElement("BR");
                hack.cmIgnore = true;
                this.dom.appendChild(hack);
            }
        };
        LineView.prototype.measureTextSize = function () {
            if (this.children.length == 0 || this.length > 20)
                return null;
            var totalWidth = 0;
            for (var _i = 0, _a = this.children; _i < _a.length; _i++) {
                var child = _a[_i];
                if (!(child instanceof TextView))
                    return null;
                var rects = clientRectsFor(child.dom);
                if (rects.length != 1)
                    return null;
                totalWidth += rects[0].width;
            }
            return { lineHeight: this.dom.getBoundingClientRect().height,
                charWidth: totalWidth / this.length };
        };
        LineView.prototype.coordsAt = function (pos) {
            if (this.length == 0)
                return this.dom.lastChild.getBoundingClientRect();
            return _super.prototype.coordsAt.call(this, pos);
        };
        // Ignore mutations in line widgets
        LineView.prototype.ignoreMutation = function (rec) {
            return !this.dom.contains(rec.target.nodeType == 1 ? rec.target : rec.target.parentNode);
        };
        // Find the appropriate widget, and ask it whether an event needs to be ignored
        LineView.prototype.ignoreEvent = function (event) {
            if (this.widgets.length == 0 || this.dom.contains(event.target))
                return false;
            for (var _i = 0, _a = this.widgets; _i < _a.length; _i++) {
                var widget = _a[_i];
                if (widget.dom.contains(event.target))
                    return widget.widget.ignoreEvent(event);
            }
            return true;
        };
        LineView.prototype.createCompositionViewAround = function (textNode) {
            var dom = textNode;
            while (dom.parentNode != this.dom)
                dom = dom.parentNode;
            var prev = dom.previousSibling, index = 0;
            while (prev) {
                var found = this.children.indexOf(prev.cmView);
                if (found > -1) {
                    index = found + 1;
                    break;
                }
                prev = prev.previousSibling;
            }
            var view = new CompositionView(dom, textNode, 0);
            this.replaceChildren(index, index, [view]);
            return view;
        };
        return LineView;
    }(ContentView));
    var LineWidget = /** @class */ (function () {
        function LineWidget(widget, side) {
            this.widget = widget;
            this.side = side;
            this.dom = null;
        }
        LineWidget.prototype.eq = function (other) {
            return this.widget.compare(other.widget) && this.side == other.side;
        };
        LineWidget.prototype.finish = function () {
            this.dom = this.widget.toDOM();
            this.dom.cmIgnore = true;
            return this;
        };
        return LineWidget;
    }());
    var none$4 = [];

    var ContentBuilder = /** @class */ (function () {
        function ContentBuilder(text, pos) {
            this.pos = pos;
            this.text = "";
            this.textOff = 0;
            this.cursor = text.iter();
            this.skip = pos;
            this.lines = [new LineView];
            this.lineStart = text.lineAt(pos).start == pos;
        }
        ContentBuilder.prototype.buildText = function (length, tagName, clss, attrs, ranges) {
            while (length > 0) {
                if (this.textOff == this.text.length) {
                    var _a = this.cursor.next(this.skip), value = _a.value, lineBreak = _a.lineBreak, done = _a.done;
                    this.skip = 0;
                    if (done)
                        throw new Error("Ran out of text content when drawing inline views");
                    if (lineBreak) {
                        this.lines.push(new LineView);
                        this.lineStart = true;
                        length--;
                        continue;
                    }
                    else {
                        this.text = value;
                        this.textOff = 0;
                    }
                }
                var take = Math.min(this.text.length - this.textOff, length);
                this.curLine.append(new TextView(this.text.slice(this.textOff, this.textOff + take), tagName, clss, attrs));
                this.lineStart = false;
                length -= take;
                this.textOff += take;
            }
        };
        ContentBuilder.prototype.advance = function (pos, active) {
            if (pos <= this.pos)
                return;
            var tagName = null, clss = null;
            var attrs = null;
            for (var _i = 0, _a = active; _i < _a.length; _i++) {
                var spec = _a[_i].spec;
                if (spec.tagName)
                    tagName = spec.tagName;
                if (spec.class)
                    clss = clss ? clss + " " + spec.class : spec.class;
                if (spec.attributes)
                    for (var name_1 in spec.attributes) {
                        var value = spec.attributes[name_1];
                        if (value == null)
                            continue;
                        if (name_1 == "class") {
                            clss = clss ? clss + " " + value : value;
                        }
                        else {
                            if (!attrs)
                                attrs = {};
                            if (name_1 == "style" && attrs.style)
                                value = attrs.style + ";" + value;
                            attrs[name_1] = value;
                        }
                    }
            }
            this.buildText(pos - this.pos, tagName, clss, attrs, active);
            this.pos = pos;
        };
        ContentBuilder.prototype.advanceCollapsed = function (pos, deco) {
            if (pos <= this.pos)
                return;
            var line = this.curLine;
            var widgetView = new WidgetView(pos - this.pos, deco.widget, 0);
            if (line.children.length && line.children[line.children.length - 1].merge(widgetView))
                line.length += widgetView.length;
            else
                line.append(widgetView);
            if (widgetView.length)
                this.lineStart = false;
            // Advance the iterator past the collapsed content
            var length = pos - this.pos;
            if (this.textOff + length <= this.text.length) {
                this.textOff += length;
            }
            else {
                this.skip += length - (this.text.length - this.textOff);
                this.text = "";
                this.textOff = 0;
            }
            this.pos = pos;
        };
        ContentBuilder.prototype.point = function (deco) {
            if (deco instanceof WidgetDecoration)
                this.curLine.append(new WidgetView(0, deco.widget, deco.bias));
            else if (this.lineStart)
                this.curLine.addLineDeco(deco);
        };
        Object.defineProperty(ContentBuilder.prototype, "curLine", {
            get: function () { return this.lines[this.lines.length - 1]; },
            enumerable: true,
            configurable: true
        });
        ContentBuilder.prototype.ignoreRange = function (deco) { return false; };
        ContentBuilder.prototype.ignorePoint = function (deco) { return false; };
        ContentBuilder.build = function (text, from, to, decorations) {
            var builder = new ContentBuilder(text, from);
            RangeSet.iterateSpans(decorations, from, to, builder);
            return builder.lines;
        };
        return ContentBuilder;
    }());

    function visiblePixelRange(dom, paddingTop) {
        var rect = dom.getBoundingClientRect();
        var top = Math.max(0, Math.min(innerHeight, rect.top)), bottom = Math.max(0, Math.min(innerHeight, rect.bottom));
        for (var parent_1 = dom.parentNode; parent_1;) { // (Cast to any because TypeScript is useless with Node types)
            if (parent_1.nodeType == 1) {
                if (parent_1.scrollHeight > parent_1.clientHeight) {
                    var parentRect = parent_1.getBoundingClientRect();
                    top = Math.min(parentRect.bottom, Math.max(parentRect.top, top));
                    bottom = Math.min(parentRect.bottom, Math.max(parentRect.top, bottom));
                }
                parent_1 = parent_1.parentNode;
            }
            else if (parent_1.nodeType == 11) { // Shadow root
                parent_1 = parent_1.host;
            }
            else {
                break;
            }
        }
        return { top: top - (rect.top + paddingTop), bottom: bottom - (rect.top + paddingTop) };
    }
    var VIEWPORT_MARGIN = 1000; // FIXME look into appropriate value of this through benchmarking etc
    var MIN_COVER_MARGIN = 10; // coveredBy requires at least this many extra pixels to be covered
    var MAX_COVER_MARGIN = VIEWPORT_MARGIN / 4;
    var ViewportState = /** @class */ (function () {
        function ViewportState() {
            this.top = 0;
            this.bottom = 0;
        }
        ViewportState.prototype.updateFromDOM = function (dom, paddingTop) {
            var _a = visiblePixelRange(dom, paddingTop), top = _a.top, bottom = _a.bottom;
            var dTop = top - this.top, dBottom = bottom - this.bottom, bias = 0;
            if (dTop > 0 && dBottom > 0)
                bias = Math.max(dTop, dBottom);
            else if (dTop < 0 && dBottom < 0)
                bias = Math.min(dTop, dBottom);
            this.top = top;
            this.bottom = bottom;
            return bias;
        };
        ViewportState.prototype.coverEverything = function () {
            this.top = -2e9;
            this.bottom = 2e9;
        };
        ViewportState.prototype.getViewport = function (doc, heightMap, bias, scrollTo) {
            // This will divide VIEWPORT_MARGIN between the top and the
            // bottom, depending on the bias (the change in viewport position
            // since the last update). It'll hold a number between 0 and 1
            var marginTop = 0.5 - Math.max(-0.5, Math.min(0.5, bias / VIEWPORT_MARGIN / 2));
            var viewport = new Viewport(heightMap.lineAt(this.top - marginTop * VIEWPORT_MARGIN, doc).start, heightMap.lineAt(this.bottom + (1 - marginTop) * VIEWPORT_MARGIN, doc).end);
            // If scrollTo is > -1, make sure the viewport includes that position
            if (scrollTo > -1) {
                if (scrollTo < viewport.from) {
                    var top_1 = heightMap.heightAt(scrollTo, doc, -1);
                    viewport = new Viewport(heightMap.lineAt(top_1 - VIEWPORT_MARGIN / 2, doc).start, heightMap.lineAt(top_1 + (this.bottom - this.top) + VIEWPORT_MARGIN / 2, doc).end);
                }
                else if (scrollTo > viewport.to) {
                    var bottom = heightMap.heightAt(scrollTo, doc, 1);
                    viewport = new Viewport(heightMap.lineAt(bottom - (this.bottom - this.top) - VIEWPORT_MARGIN / 2, doc).start, heightMap.lineAt(bottom + VIEWPORT_MARGIN / 2, doc).end);
                }
            }
            return viewport;
        };
        ViewportState.prototype.coveredBy = function (doc, viewport, heightMap, bias) {
            if (bias === void 0) { bias = 0; }
            var top = heightMap.heightAt(viewport.from, doc, -1), bottom = heightMap.heightAt(viewport.to, doc, 1);
            return (viewport.from == 0 || top <= this.top - Math.max(MIN_COVER_MARGIN, Math.min(-bias, MAX_COVER_MARGIN))) &&
                (viewport.to == doc.length || bottom >= this.bottom + Math.max(MIN_COVER_MARGIN, Math.min(bias, MAX_COVER_MARGIN)));
        };
        return ViewportState;
    }());
    var Viewport = /** @class */ (function () {
        function Viewport(from, to) {
            this.from = from;
            this.to = to;
        }
        Viewport.prototype.clip = function (pos) { return Math.max(this.from, Math.min(this.to, pos)); };
        Viewport.prototype.eq = function (b) { return this.from == b.from && this.to == b.to; };
        return Viewport;
    }());

    var observeOptions = {
        childList: true,
        characterData: true,
        subtree: true,
        characterDataOldValue: true
    };
    // IE11 has very broken mutation observers, so we also listen to
    // DOMCharacterDataModified there
    var useCharData = browser.ie && browser.ie_version <= 11;
    var DOMObserver = /** @class */ (function () {
        function DOMObserver(docView, onChange, onScrollChanged) {
            var _this = this;
            this.docView = docView;
            this.onChange = onChange;
            this.onScrollChanged = onScrollChanged;
            this.active = false;
            this.ignoreSelection = new DOMSelection;
            this.charDataQueue = [];
            this.charDataTimeout = null;
            this.scrollTargets = [];
            this.intersection = null;
            this.intersecting = false;
            this.dom = docView.dom;
            this.observer = new MutationObserver(function (mutations) { return _this.flush(mutations); });
            if (useCharData)
                this.onCharData = function (event) {
                    _this.charDataQueue.push({ target: event.target,
                        type: "characterData",
                        oldValue: event.prevValue });
                    if (_this.charDataTimeout == null)
                        _this.charDataTimeout = setTimeout(function () { return _this.flush(); }, 20);
                };
            this.onSelectionChange = function () {
                if (_this.docView.root.activeElement == _this.dom)
                    _this.flush();
            };
            this.start();
            this.onScroll = this.onScroll.bind(this);
            window.addEventListener("scroll", this.onScroll);
            if (typeof IntersectionObserver == "function") {
                this.intersection = new IntersectionObserver(function (entries) {
                    if (entries[entries.length - 1].intersectionRatio > 0 != _this.intersecting) {
                        _this.intersecting = !_this.intersecting;
                        _this.onScroll();
                    }
                }, {});
                this.intersection.observe(this.dom);
            }
            this.listenForScroll();
        }
        DOMObserver.prototype.onScroll = function () {
            if (this.intersecting) {
                this.flush();
                this.onScrollChanged();
            }
        };
        DOMObserver.prototype.listenForScroll = function () {
            var i = 0, changed = null;
            for (var dom = this.dom; dom;) {
                if (dom.nodeType == 1) {
                    if (!changed && i < this.scrollTargets.length && this.scrollTargets[i] == dom)
                        i++;
                    else if (!changed)
                        changed = this.scrollTargets.slice(0, i);
                    if (changed)
                        changed.push(dom);
                    dom = dom.parentNode;
                }
                else if (dom.nodeType == 11) { // Shadow root
                    dom = dom.host;
                }
                else {
                    break;
                }
            }
            if (i < this.scrollTargets.length && !changed)
                changed = this.scrollTargets.slice(0, i);
            if (changed) {
                for (var _i = 0, _a = this.scrollTargets; _i < _a.length; _i++) {
                    var dom = _a[_i];
                    dom.removeEventListener("scroll", this.onScroll);
                }
                for (var _b = 0, _c = this.scrollTargets = changed; _b < _c.length; _b++) {
                    var dom = _c[_b];
                    dom.addEventListener("scroll", this.onScroll);
                }
            }
        };
        DOMObserver.prototype.ignore = function (f) {
            if (!this.active)
                return f();
            try {
                this.stop();
                return f();
            }
            finally {
                this.start();
                this.clear();
            }
        };
        DOMObserver.prototype.start = function () {
            if (this.active)
                return;
            this.observer.observe(this.dom, observeOptions);
            // FIXME is this shadow-root safe?
            this.dom.ownerDocument.addEventListener("selectionchange", this.onSelectionChange);
            if (useCharData)
                this.dom.addEventListener("DOMCharacterDataModified", this.onCharData);
            this.active = true;
        };
        DOMObserver.prototype.stop = function () {
            if (!this.active)
                return;
            this.active = false;
            this.observer.disconnect();
            this.dom.ownerDocument.removeEventListener("selectionchange", this.onSelectionChange);
            if (useCharData)
                this.dom.removeEventListener("DOMCharacterDataModified", this.onCharData);
        };
        DOMObserver.prototype.takeCharRecords = function () {
            var result = this.charDataQueue;
            if (result.length) {
                this.charDataQueue = [];
                clearTimeout(this.charDataTimeout);
                this.charDataTimeout = null;
            }
            return result;
        };
        DOMObserver.prototype.clearSelection = function () {
            this.ignoreSelection.set(this.docView.root.getSelection());
        };
        // Throw away any pending changes
        DOMObserver.prototype.clear = function () {
            this.observer.takeRecords();
            this.takeCharRecords();
            this.clearSelection();
        };
        // Apply pending changes, if any
        DOMObserver.prototype.flush = function (records) {
            var _this = this;
            if (records === void 0) { records = this.observer.takeRecords(); }
            if (this.charDataQueue.length)
                records = records.concat(this.takeCharRecords());
            var selection = this.docView.root.getSelection();
            var newSel = !this.ignoreSelection.eq(selection) && hasSelection(this.dom, selection);
            if (records.length == 0 && !newSel)
                return;
            var from = -1, to = -1, typeOver = false;
            for (var _i = 0, records_1 = records; _i < records_1.length; _i++) {
                var record = records_1[_i];
                var range = this.readMutation(record);
                if (!range)
                    continue;
                if (range.typeOver)
                    typeOver = true;
                if (from == -1) {
                    (from = range.from, to = range.to);
                }
                else {
                    from = Math.min(range.from, from);
                    to = Math.max(range.to, to);
                }
            }
            var apply = from > -1 || newSel;
            if (!apply || !this.onChange(from, to, typeOver)) {
                if (this.docView.dirty)
                    this.ignore(function () { return _this.docView.sync(); });
                this.docView.updateSelection();
            }
            this.clearSelection();
        };
        DOMObserver.prototype.readMutation = function (rec) {
            var cView = this.docView.nearest(rec.target);
            if (!cView || cView.ignoreMutation(rec))
                return null;
            cView.markDirty();
            if (rec.type == "childList") {
                var childBefore = findChild(cView, rec.previousSibling || rec.target.previousSibling, -1);
                var childAfter = findChild(cView, rec.nextSibling || rec.target.nextSibling, 1);
                return { from: childBefore ? cView.posAfter(childBefore) : cView.posAtStart,
                    to: childAfter ? cView.posBefore(childAfter) : cView.posAtEnd, typeOver: false };
            }
            else { // "characterData"
                return { from: cView.posAtStart, to: cView.posAtEnd, typeOver: rec.target.nodeValue == rec.oldValue };
            }
        };
        DOMObserver.prototype.destroy = function () {
            this.stop();
            if (this.intersection)
                this.intersection.disconnect();
            for (var _i = 0, _a = this.scrollTargets; _i < _a.length; _i++) {
                var dom = _a[_i];
                dom.removeEventListener("scroll", this.onScroll);
            }
            window.removeEventListener("scroll", this.onScroll);
        };
        return DOMObserver;
    }());
    function findChild(cView, dom, dir) {
        while (dom) {
            var curView = dom.cmView;
            if (curView && curView.parent == cView)
                return curView;
            var parent_1 = dom.parentNode;
            dom = parent_1 != cView.dom ? parent_1 : dir > 0 ? dom.nextSibling : dom.previousSibling;
        }
        return null;
    }

    var wrappingWhiteSpace = ["pre-wrap", "normal", "pre-line"];
    var HeightOracle = /** @class */ (function () {
        function HeightOracle() {
            this.doc = Text.of([""]);
            this.lineWrapping = false;
            this.heightSamples = {};
            this.lineHeight = 14;
            this.charWidth = 7;
            this.lineLength = 30;
            // Used to track, during updateHeight, if any actual heights changed
            this.heightChanged = false;
        }
        HeightOracle.prototype.heightForGap = function (from, to) {
            var lines = this.doc.lineAt(to).number - this.doc.lineAt(from).number + 1;
            if (this.lineWrapping)
                lines += Math.ceil(((to - from) - (lines * this.lineLength * 0.5)) / this.lineLength);
            return this.lineHeight * lines;
        };
        HeightOracle.prototype.heightForLine = function (length) {
            if (!this.lineWrapping)
                return this.lineHeight;
            var lines = 1 + Math.max(0, Math.ceil((length - this.lineLength) / (this.lineLength - 5)));
            return lines * this.lineHeight;
        };
        HeightOracle.prototype.setDoc = function (doc) { this.doc = doc; return this; };
        HeightOracle.prototype.mustRefresh = function (lineHeights) {
            var newHeight = false;
            for (var i = 0; i < lineHeights.length; i++) {
                var h = lineHeights[i];
                if (h < 0) {
                    i++;
                }
                else if (!this.heightSamples[Math.floor(h * 10)]) { // Round to .1 pixels
                    newHeight = true;
                    this.heightSamples[Math.floor(h * 10)] = true;
                }
            }
            return newHeight;
        };
        HeightOracle.prototype.refresh = function (whiteSpace, lineHeight, charWidth, lineLength, knownHeights) {
            var lineWrapping = wrappingWhiteSpace.indexOf(whiteSpace) > -1;
            var changed = Math.round(lineHeight) != Math.round(this.lineHeight) || this.lineWrapping != lineWrapping;
            this.lineWrapping = lineWrapping;
            this.lineHeight = lineHeight;
            this.charWidth = charWidth;
            this.lineLength = lineLength;
            if (changed) {
                this.heightSamples = {};
                for (var i = 0; i < knownHeights.length; i++) {
                    var h = knownHeights[i];
                    if (h < 0)
                        i++;
                    else
                        this.heightSamples[Math.floor(h * 10)] = true;
                }
            }
            return changed;
        };
        return HeightOracle;
    }());
    // This object is used by `updateHeight` to make DOM measurements
    // arrive at the right lines. The `heights` array is a sequence of
    // line heights, starting from position `from`. When the lines have
    // line widgets, their height may be followed by a -1 or -2
    // (indicating whether the height is below or above the line) and then
    // a total widget height.
    var MeasuredHeights = /** @class */ (function () {
        function MeasuredHeights(from, heights) {
            this.from = from;
            this.heights = heights;
            this.index = 0;
        }
        Object.defineProperty(MeasuredHeights.prototype, "more", {
            get: function () { return this.index < this.heights.length; },
            enumerable: true,
            configurable: true
        });
        return MeasuredHeights;
    }());
    var LineHeight = /** @class */ (function () {
        function LineHeight(start, end, top, height, 
        // @internal
        line) {
            this.start = start;
            this.end = end;
            this.top = top;
            this.height = height;
            this.line = line;
        }
        Object.defineProperty(LineHeight.prototype, "bottom", {
            get: function () { return this.top + this.height; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(LineHeight.prototype, "textTop", {
            get: function () { return this.top + (this.line ? lineWidgetHeight(this.line.deco, -2) : 0); },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(LineHeight.prototype, "textBottom", {
            get: function () { return this.bottom - (this.line ? lineWidgetHeight(this.line.deco, -1) : 0); },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(LineHeight.prototype, "hasCollapsedRanges", {
            get: function () {
                if (this.line)
                    for (var i = 1; i < this.line.deco.length; i += 2)
                        if (this.line.deco[i] < 0)
                            return true;
                return false;
            },
            enumerable: true,
            configurable: true
        });
        return LineHeight;
    }());
    var HeightMap = /** @class */ (function () {
        function HeightMap(length, // The number of characters covered
        height, // Height of this part of the document
        outdated // Tracks whether the height needs to be recomputed
        ) {
            if (outdated === void 0) { outdated = true; }
            this.length = length;
            this.height = height;
            this.outdated = outdated;
        }
        HeightMap.prototype.setHeight = function (oracle, height) {
            if (this.height != height) {
                this.height = height;
                oracle.heightChanged = true;
            }
        };
        // from/to are node-relative positions pointing into the node itself
        // newFrom/newTo are document-relative positions in the updated
        // document, used for querying line endings and such
        HeightMap.prototype.replace = function (from, to, nodes, oracle, newFrom, newTo) {
            var result = [];
            this.decomposeLeft(from, result, nodes[0], oracle, newFrom);
            var last;
            if (nodes.length == 1) {
                last = result.pop();
            }
            else {
                for (var i = 1; i < nodes.length - 1; i++)
                    result.push(nodes[i]);
                last = nodes[nodes.length - 1];
            }
            this.decomposeRight(to, result, last, oracle, newTo);
            return HeightMap.of(result);
        };
        HeightMap.prototype.applyChanges = function (decorations, oracle, changes) {
            var me = this, off = 0;
            for (var i = 0; i < changes.length; i++) {
                var range = changes[i];
                var nodes = buildChangedNodes(oracle, decorations, range.fromB, range.toB);
                me = me.replace(range.fromA + off, range.toA + off, nodes, oracle, range.fromB, range.toB);
                off += range.lenDiff;
            }
            return me;
        };
        HeightMap.empty = function () { return new HeightMapLine(0, 0); };
        HeightMap.of = function (nodes) {
            if (nodes.length == 1)
                return nodes[0];
            var i = 0, j = nodes.length, before = 0, after = 0;
            while (i < j) {
                if (before < after)
                    before += nodes[i++].size;
                else
                    after += nodes[--j].size;
            }
            for (;;) {
                if (before > after * 2) {
                    var _a = nodes[i - 1], left = _a.left, right = _a.right;
                    nodes.splice(i - 1, 1, left, right);
                    before -= right.size;
                    after += right.size;
                }
                else if (after > before * 2) {
                    var _b = nodes[i], left = _b.left, right = _b.right;
                    nodes.splice(i++, 1, left, right);
                    after -= left.size;
                    before += left.size;
                }
                else {
                    break;
                }
            }
            return new HeightMapBranch(HeightMap.of(nodes.slice(0, i)), HeightMap.of(nodes.slice(i)));
        };
        return HeightMap;
    }());
    var noDeco = [];
    var HeightMapLine = /** @class */ (function (_super) {
        __extends(HeightMapLine, _super);
        // Decoration information is stored in a somewhat obscure format—the
        // array of numbers in `deco` encodes all of collapsed ranges,
        // inline widgets, and widgets above/below the line. It contains a
        // series of pairs of numbers.
        //
        //  - The first number indicates the position of the decoration, or
        //    -2 for widget height above the line, or -1 for widget height
        //    below the line (see `lineWidgetHeight` and
        //    `setLineWidgetHeight`)
        //
        //  - The second number is the height of a widget when positive, or
        //    the number of collapse code points if negative.
        //
        // These are the pieces of information that need to be stored about
        // lines to somewhat effectively estimate their height when they are
        // not actually in view and thus can not be measured. Widget size
        // above/below is also necessary in heightAt, to skip it.
        //
        // The somewhat awkward format is there to reduce the amount of
        // space required—you can have a huge number of line heightmap
        // objects when scrolling through a big document, and most of them
        // don't need any extra data, and thus can just store a single
        // pointer to `noDeco`.
        function HeightMapLine(length, height, deco) {
            if (deco === void 0) { deco = noDeco; }
            var _this = _super.call(this, length, height) || this;
            _this.deco = deco;
            return _this;
        }
        Object.defineProperty(HeightMapLine.prototype, "size", {
            get: function () { return 1; },
            enumerable: true,
            configurable: true
        });
        HeightMapLine.prototype.heightAt = function (pos, doc, bias) {
            return bias < 0 ? lineWidgetHeight(this.deco, -2) : this.height - lineWidgetHeight(this.deco, -1);
        };
        HeightMapLine.prototype.lineAt = function (height, doc, offset) {
            if (offset === void 0) { offset = 0; }
            return new LineHeight(offset, offset + this.length, -height, this.height, this);
        };
        HeightMapLine.prototype.lineViewport = function (pos, doc, offset) {
            if (offset === void 0) { offset = 0; }
            return new Viewport(offset, offset + this.length);
        };
        HeightMapLine.prototype.replace = function (from, to, nodes, oracle, newFrom, newTo) {
            if (nodes.length != 1 || (nodes[0] instanceof HeightMapGap && oracle.doc.lineAt(newFrom).end < newTo))
                return _super.prototype.replace.call(this, from, to, nodes, oracle, newFrom, newTo);
            this.deco = offsetDeco(this.deco, from, to, nodes[0].length);
            if (nodes[0] instanceof HeightMapLine)
                this.deco = insertDeco(this.deco, nodes[0].deco, from);
            this.length += nodes[0].length - (to - from);
            this.outdated = true;
            return this;
        };
        HeightMapLine.prototype.decomposeLeft = function (to, target, node, oracle, newTo) {
            if (to == 0) {
                target.push(node);
            }
            else if (node instanceof HeightMapLine) {
                target.push(this.joinLine(to, this.length, node));
            }
            else {
                var nextEnd = oracle.doc.lineAt(newTo).end, breakInside = nextEnd < newTo + node.length;
                var newLen = to + (breakInside ? nextEnd - newTo : node.length);
                target.push(new HeightMapLine(newLen, this.height, offsetDeco(this.deco, to, this.length, 0)));
                if (breakInside)
                    target.push(new HeightMapGap(nextEnd + 1, newTo + node.length, oracle));
            }
        };
        HeightMapLine.prototype.decomposeRight = function (from, target, node, oracle, newFrom) {
            if (from == this.length) {
                target.push(node);
            }
            else if (node instanceof HeightMapLine) {
                target.push(this.joinLine(0, from, node));
            }
            else {
                var prevStart = oracle.doc.lineAt(newFrom).start, breakInside = prevStart > newFrom - node.length;
                if (breakInside)
                    target.push(new HeightMapGap(newFrom - node.length, prevStart - 1, oracle));
                var newLen = (breakInside ? newFrom - prevStart : node.length) + (this.length - from);
                target.push(new HeightMapLine(newLen, this.height, offsetDeco(this.deco, 0, from, newLen - this.length)));
            }
        };
        HeightMapLine.prototype.joinLine = function (from, to, node) {
            var deco = insertDeco(offsetDeco(this.deco, from, to, node.length), node.deco, from);
            return new HeightMapLine(this.length + node.length - (to - from), Math.max(this.height, node.height), deco);
        };
        HeightMapLine.prototype.updateHeight = function (oracle, offset, force, measured) {
            if (offset === void 0) { offset = 0; }
            if (force === void 0) { force = false; }
            if (measured && measured.from <= offset && measured.more) {
                var height = measured.heights[measured.index++];
                // If either this line's deco data or the measured heights contain info about
                if (this.deco.length && this.deco[0] < 0 || measured.more && measured.heights[measured.index] < 0) {
                    var above = measured.more && measured.heights[measured.index] == -2
                        ? measured.heights[(measured.index += 2) - 1] : 0;
                    var below = measured.more && measured.heights[measured.index] == -1
                        ? measured.heights[(measured.index += 2) - 1] : 0;
                    this.deco = setLineWidgetHeight(setLineWidgetHeight(this.deco.slice(), -2, above), -1, below);
                    height += above + below;
                }
                this.setHeight(oracle, height);
            }
            else if (force || this.outdated) {
                var len = this.length, minH = 0, add = 0;
                for (var i = 1; i < this.deco.length; i += 2) {
                    var val = this.deco[i];
                    if (val < 0)
                        len += val;
                    else if (this.deco[i - 1] < 0)
                        add += val;
                    else
                        minH = Math.max(val, minH);
                }
                this.setHeight(oracle, Math.max(oracle.heightForLine(len), minH) + add);
            }
            this.outdated = false;
            return this;
        };
        HeightMapLine.prototype.toString = function () { return "line(" + this.length + (this.deco.length ? ":" + this.deco.join(",") : "") + ")"; };
        HeightMapLine.prototype.forEachLine = function (from, to, offset, oracle, f) {
            f(new LineHeight(offset, offset + this.length, 0, this.height, this));
        };
        Object.defineProperty(HeightMapLine.prototype, "hasCollapsedRanges", {
            get: function () {
                for (var i = 1; i < this.deco.length; i += 2)
                    if (this.deco[i] < 0)
                        return true;
                return false;
            },
            enumerable: true,
            configurable: true
        });
        return HeightMapLine;
    }(HeightMap));
    function offsetDeco(deco, from, to, length) {
        var result = null;
        var off = length - (to - from);
        for (var i = 0; i < deco.length; i += 2) {
            var pos = deco[i];
            if (Math.max(0, pos) < from || pos > to && off == 0)
                continue;
            if (!result)
                result = deco.slice(0, i);
            if (pos > to)
                result.push(pos + off, deco[i + 1]);
        }
        return !result ? deco : result.length ? result : noDeco;
    }
    function insertDeco(deco, newDeco, pos) {
        if (newDeco.length == 0)
            return deco;
        var result = [], inserted = false;
        for (var i = 0;; i += 2) {
            var next = i == deco.length ? 2e9 : deco[i];
            if (!inserted && next > pos) {
                for (var j = 0; j < newDeco.length; j += 2)
                    if (pos == 0 || newDeco[j] >= 0)
                        result.push(newDeco[j] + pos, newDeco[j + 1]);
                inserted = true;
            }
            if (next == 2e9)
                return result;
            result.push(next, deco[i + 1]);
        }
    }
    function lineWidgetHeight(deco, type) {
        for (var i = 0; i < deco.length; i += 2) {
            var pos = deco[i];
            if (pos >= 0)
                break;
            if (pos == type)
                return deco[i + 1];
        }
        return 0;
    }
    function setLineWidgetHeight(deco, type, height) {
        var i = 0;
        for (; i < deco.length; i += 2) {
            var pos = deco[i];
            if (pos > type)
                break;
            if (pos == type) {
                deco[i + 1] = height;
                return deco;
            }
        }
        if (height > 0)
            deco.splice(i, 0, type, height);
        return deco;
    }
    var HeightMapGap = /** @class */ (function (_super) {
        __extends(HeightMapGap, _super);
        function HeightMapGap(from, to, oracle) {
            return _super.call(this, to - from, oracle.heightForGap(from, to), false) || this;
        }
        Object.defineProperty(HeightMapGap.prototype, "size", {
            get: function () { return 1; },
            enumerable: true,
            configurable: true
        });
        HeightMapGap.prototype.heightAt = function (pos, doc, bias, offset) {
            if (offset === void 0) { offset = 0; }
            var firstLine = doc.lineAt(offset).number, lastLine = doc.lineAt(offset + this.length).number;
            var lines = lastLine - firstLine + 1;
            return (doc.lineAt(pos).number - firstLine + (bias > 0 ? 1 : 0)) * (this.height / lines);
        };
        HeightMapGap.prototype.lineAt = function (height, doc, offset) {
            if (offset === void 0) { offset = 0; }
            var firstLine = doc.lineAt(offset).number, lastLine = doc.lineAt(offset + this.length).number;
            var lines = lastLine - firstLine, line = Math.floor(lines * Math.max(0, Math.min(1, height / this.height)));
            var heightPerLine = this.height / (lines + 1), top = heightPerLine * line - height;
            var _a = doc.line(firstLine + line), start = _a.start, end = _a.end;
            return new LineHeight(start, end, top, heightPerLine, null);
        };
        HeightMapGap.prototype.lineViewport = function (pos, doc, offset) {
            if (offset === void 0) { offset = 0; }
            var _a = doc.lineAt(pos + offset), start = _a.start, end = _a.end;
            return new Viewport(start, end);
        };
        HeightMapGap.prototype.replace = function (from, to, nodes, oracle, newFrom, newTo) {
            if (nodes.length != 1 || !(nodes[0] instanceof HeightMapGap))
                return _super.prototype.replace.call(this, from, to, nodes, oracle, newFrom, newTo);
            this.length += (newTo - newFrom) - (to - from);
            var newStart = newFrom - from;
            // FIXME the Math.min is a kludge to deal with the fact that, if
            // there are further changes that'll be applied by applyChanges,
            // the estimated length here may extend past the end of the document
            this.setHeight(oracle, oracle.heightForGap(newStart, Math.min(oracle.doc.length, newStart + this.length)));
            return this;
        };
        HeightMapGap.prototype.decomposeLeft = function (to, target, node, oracle, newTo) {
            var newOffset = newTo - to;
            if (node instanceof HeightMapGap) {
                target.push(new HeightMapGap(newOffset, newTo + node.length, oracle));
            }
            else {
                var lineStart = oracle.doc.lineAt(newTo).start;
                if (lineStart > newOffset)
                    target.push(new HeightMapGap(newOffset, lineStart - 1, oracle));
                var deco = offsetDeco(node.deco, 0, 0, newTo - lineStart);
                target.push(new HeightMapLine(newTo + node.length - lineStart, node.height, deco));
            }
        };
        HeightMapGap.prototype.decomposeRight = function (from, target, node, oracle, newFrom) {
            var newEnd = newFrom + (this.length - from);
            if (node instanceof HeightMapGap) {
                target.push(new HeightMapGap(newFrom - node.length, newEnd, oracle));
            }
            else {
                var lineEnd = oracle.doc.lineAt(newFrom).end;
                target.push(new HeightMapLine(node.length + (lineEnd - newFrom), node.height, node.deco));
                if (newEnd > lineEnd)
                    target.push(new HeightMapGap(lineEnd + 1, newEnd, oracle));
            }
        };
        HeightMapGap.prototype.updateHeight = function (oracle, offset, force, measured) {
            if (offset === void 0) { offset = 0; }
            if (force === void 0) { force = false; }
            var end = offset + this.length;
            if (measured && measured.from <= offset + this.length && measured.more) {
                var nodes = [], pos = Math.max(offset, measured.from);
                if (measured.from > offset)
                    nodes.push(new HeightMapGap(offset, measured.from - 1, oracle));
                while (pos <= end && measured.more) {
                    var height = measured.heights[measured.index++], deco = undefined, wType = void 0;
                    while (measured.more && (wType = measured.heights[measured.index]) < 0) {
                        var wHeight = measured.heights[(measured.index += 2) - 1];
                        height += wHeight;
                        deco = setLineWidgetHeight(deco || [], wType, wHeight);
                    }
                    var len = oracle.doc.lineAt(pos).length;
                    nodes.push(new HeightMapLine(len, height, deco));
                    pos += len + 1;
                }
                if (pos < end)
                    nodes.push(new HeightMapGap(pos, end, oracle));
                for (var _i = 0, nodes_1 = nodes; _i < nodes_1.length; _i++) {
                    var node = nodes_1[_i];
                    node.outdated = false;
                }
                oracle.heightChanged = true;
                return HeightMap.of(nodes);
            }
            else if (force || this.outdated) {
                this.setHeight(oracle, oracle.heightForGap(offset, offset + this.length));
                this.outdated = false;
            }
            return this;
        };
        HeightMapGap.prototype.toString = function () { return "gap(" + this.length + ")"; };
        HeightMapGap.prototype.forEachLine = function (from, to, offset, oracle, f) {
            for (var pos = Math.max(from, offset), end = Math.min(to, offset + this.length); pos <= end;) {
                var end_1 = oracle.doc.lineAt(pos).end;
                f(new LineHeight(pos, end_1, 0, oracle.heightForLine(end_1 - pos), null));
                pos = end_1 + 1;
            }
        };
        return HeightMapGap;
    }(HeightMap));
    var HeightMapBranch = /** @class */ (function (_super) {
        __extends(HeightMapBranch, _super);
        function HeightMapBranch(left, right) {
            var _this = _super.call(this, left.length + 1 + right.length, left.height + right.height, left.outdated || right.outdated) || this;
            _this.left = left;
            _this.right = right;
            _this.size = left.size + right.size;
            return _this;
        }
        HeightMapBranch.prototype.heightAt = function (pos, doc, bias, offset) {
            if (offset === void 0) { offset = 0; }
            var rightStart = offset + this.left.length + 1;
            return pos < rightStart ? this.left.heightAt(pos, doc, bias, offset)
                : this.left.height + this.right.heightAt(pos, doc, bias, rightStart);
        };
        HeightMapBranch.prototype.lineAt = function (height, doc, offset) {
            if (offset === void 0) { offset = 0; }
            var right = height - this.left.height;
            if (right < 0)
                return this.left.lineAt(height, doc, offset);
            return this.right.lineAt(right, doc, offset + this.left.length + 1);
        };
        HeightMapBranch.prototype.lineViewport = function (pos, doc, offset) {
            if (offset === void 0) { offset = 0; }
            var rightStart = this.left.length + 1;
            return pos < rightStart ? this.left.lineViewport(pos, doc, offset)
                : this.right.lineViewport(pos - rightStart, doc, offset + rightStart);
        };
        HeightMapBranch.prototype.replace = function (from, to, nodes, oracle, newFrom, newTo) {
            var rightStart = this.left.length + 1;
            if (to < rightStart)
                return this.balanced(this.left.replace(from, to, nodes, oracle, newFrom, newTo), this.right);
            else if (from >= rightStart)
                return this.balanced(this.left, this.right.replace(from - rightStart, to - rightStart, nodes, oracle, newFrom, newTo));
            else
                return _super.prototype.replace.call(this, from, to, nodes, oracle, newFrom, newTo);
        };
        HeightMapBranch.prototype.decomposeLeft = function (to, target, node, oracle, newTo) {
            var rightStart = this.left.length + 1;
            if (to < rightStart) {
                this.left.decomposeLeft(to, target, node, oracle, newTo);
            }
            else {
                target.push(this.left);
                this.right.decomposeLeft(to - rightStart, target, node, oracle, newTo);
            }
        };
        HeightMapBranch.prototype.decomposeRight = function (from, target, node, oracle, newFrom) {
            var rightStart = this.left.length + 1;
            if (from < rightStart) {
                this.left.decomposeRight(from, target, node, oracle, newFrom);
                target.push(this.right);
            }
            else {
                this.right.decomposeRight(from - rightStart, target, node, oracle, newFrom);
            }
        };
        HeightMapBranch.prototype.balanced = function (left, right) {
            if (left.size > 2 * right.size || right.size > 2 * left.size)
                return HeightMap.of([left, right]);
            this.left = left;
            this.right = right;
            this.height = left.height + right.height;
            this.outdated = left.outdated || right.outdated;
            this.size = left.size + right.size;
            this.length = left.length + 1 + right.length;
            return this;
        };
        HeightMapBranch.prototype.updateHeight = function (oracle, offset, force, measured) {
            if (offset === void 0) { offset = 0; }
            if (force === void 0) { force = false; }
            var _a = this, left = _a.left, right = _a.right, rightStart = offset + left.length + 1, rebalance = null;
            if (measured && measured.from <= offset + left.length && measured.more)
                rebalance = left = left.updateHeight(oracle, offset, force, measured);
            else
                left.updateHeight(oracle, offset, force);
            if (measured && measured.from <= rightStart + right.length && measured.more)
                rebalance = right = right.updateHeight(oracle, rightStart, force, measured);
            else
                right.updateHeight(oracle, rightStart, force);
            if (rebalance)
                return this.balanced(left, right);
            this.height = this.left.height + this.right.height;
            this.outdated = false;
            return this;
        };
        HeightMapBranch.prototype.toString = function () { return this.left + " " + this.right; };
        HeightMapBranch.prototype.forEachLine = function (from, to, offset, oracle, f) {
            var rightStart = offset + this.left.length + 1;
            if (from < rightStart)
                this.left.forEachLine(from, to, offset, oracle, f);
            if (to >= rightStart)
                this.right.forEachLine(from, to, rightStart, oracle, f);
        };
        return HeightMapBranch;
    }(HeightMap));
    var NodeBuilder = /** @class */ (function () {
        function NodeBuilder(pos, oracle) {
            this.pos = pos;
            this.oracle = oracle;
            this.nodes = [];
            this.lineStart = -1;
            this.lineEnd = -1;
            this.curLine = null;
            this.writtenTo = pos;
        }
        NodeBuilder.prototype.advance = function (pos) {
            if (pos <= this.pos)
                return;
            if (this.curLine) {
                if (this.lineEnd < 0)
                    this.lineEnd = this.oracle.doc.lineAt(this.pos).end;
                if (pos > this.lineEnd) {
                    this.curLine.length += (this.lineEnd - this.pos);
                    this.curLine.updateHeight(this.oracle, this.lineEnd - this.curLine.length);
                    this.curLine = null;
                    this.writtenTo = this.lineEnd + 1;
                    this.lineEnd = -1;
                }
                else {
                    this.curLine.length += (pos - this.pos);
                    this.writtenTo = pos;
                }
            }
            else if (this.lineEnd > -1 && pos > this.lineEnd) {
                this.lineEnd = -1;
            }
            this.pos = pos;
        };
        NodeBuilder.prototype.advanceCollapsed = function (pos, deco) {
            if (pos <= this.pos)
                return;
            if (deco.widget && deco.widget.estimatedHeight >= 0)
                this.addDeco(deco.widget.estimatedHeight);
            this.addDeco(this.pos - pos);
            if (this.curLine) {
                this.curLine.length += pos - this.pos;
                this.writtenTo = pos;
                if (this.lineEnd < pos)
                    this.lineEnd = -1;
            }
            this.pos = pos;
        };
        NodeBuilder.prototype.point = function (deco) {
            this.addDeco(deco.widget.estimatedHeight, deco instanceof LineDecoration ? (deco.side > 0 ? -1 : -2) : undefined);
        };
        NodeBuilder.prototype.flushTo = function (pos) {
            if (pos > this.writtenTo) {
                this.nodes.push(new HeightMapGap(this.writtenTo, pos, this.oracle));
                this.writtenTo = pos;
            }
        };
        NodeBuilder.prototype.addDeco = function (val, lineWidget) {
            if (!this.curLine) {
                this.lineStart = Math.max(this.writtenTo, this.oracle.doc.lineAt(this.pos).start);
                this.flushTo(this.lineStart - 1);
                this.nodes.push(this.curLine = new HeightMapLine(this.pos - this.lineStart, 0, []));
                this.writtenTo = this.pos;
            }
            if (lineWidget == null)
                this.curLine.deco.push(this.pos - this.lineStart, val);
            else
                setLineWidgetHeight(this.curLine.deco, lineWidget, val + lineWidgetHeight(this.curLine.deco, lineWidget));
        };
        NodeBuilder.prototype.ignoreRange = function (value) { return !value.collapsed; };
        NodeBuilder.prototype.ignorePoint = function (value) { return !(value.widget && value.widget.estimatedHeight > 0); };
        return NodeBuilder;
    }());
    function buildChangedNodes(oracle, decorations, from, to) {
        var builder = new NodeBuilder(from, oracle);
        RangeSet.iterateSpans(decorations, from, to, builder);
        if (builder.curLine)
            builder.curLine.updateHeight(oracle, builder.pos - builder.curLine.length);
        else
            builder.flushTo(builder.pos);
        if (builder.nodes.length == 0)
            builder.nodes.push(new HeightMapGap(0, 0, oracle));
        return builder.nodes;
    }

    var ViewField = /** @class */ (function () {
        function ViewField(_a) {
            var create = _a.create, update = _a.update, _b = _a.effects, effects = _b === void 0 ? [] : _b;
            this.create = create;
            this.update = update;
            this.effects = effects;
        }
        Object.defineProperty(ViewField.prototype, "extension", {
            get: function () { return viewField(this); },
            enumerable: true,
            configurable: true
        });
        ViewField.decorations = function (_a) {
            var create = _a.create, update = _a.update, map = _a.map;
            return new ViewField({
                create: create || (function () { return Decoration.none; }),
                update: function (deco, u) {
                    if (map)
                        for (var _i = 0, _a = u.transactions; _i < _a.length; _i++) {
                            var tr = _a[_i];
                            deco = deco.map(tr.changes);
                        }
                    return update(deco, u);
                },
                effects: [ViewField.decorationEffect(function (d) { return d; })]
            }).extension;
        };
        ViewField.decorationEffect = Slot.define();
        ViewField.editorAttributeEffect = Slot.define();
        ViewField.contentAttributeEffect = Slot.define();
        ViewField.editorAttributes = attributeField(ViewField.editorAttributeEffect);
        ViewField.contentAttributes = attributeField(ViewField.contentAttributeEffect);
        return ViewField;
    }());
    function attributeField(effect) {
        return function (value, update) {
            return new ViewField({
                create: value instanceof Function ? value : function () { return value; },
                update: update || (function (a) { return a; }), effects: [effect(function (a) { return a; })]
            }).extension;
        };
    }
    var ViewExtension = /** @class */ (function (_super) {
        __extends(ViewExtension, _super);
        function ViewExtension() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        return ViewExtension;
    }(Extension));
    var viewField = ViewExtension.defineBehavior();
    var handleDOMEvents = ViewExtension.defineBehavior();
    var viewPlugin = ViewExtension.defineBehavior();
    var styleModule = ViewExtension.defineBehavior();
    var ViewSnapshot = /** @class */ (function () {
        function ViewSnapshot(view) {
            this.state = view.state;
            this.fields = view.fields;
            this.fieldValues = view.fieldValues;
            this.viewport = view.viewport;
        }
        return ViewSnapshot;
    }());
    var focusChange = Slot.define();
    var ViewUpdate = /** @class */ (function () {
        function ViewUpdate(prev, transactions, view, metadata) {
            this.prev = prev;
            this.transactions = transactions;
            this.view = view;
            this.metadata = metadata;
        }
        Object.defineProperty(ViewUpdate.prototype, "prevState", {
            get: function () { return this.prev.state; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(ViewUpdate.prototype, "state", {
            get: function () { return this.view.state; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(ViewUpdate.prototype, "prevViewport", {
            get: function () { return this.prev.viewport; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(ViewUpdate.prototype, "viewport", {
            get: function () { return this.view.viewport; },
            enumerable: true,
            configurable: true
        });
        ViewUpdate.prototype.prevField = function (field, defaultValue) {
            return getField(field, this.prev.fields, this.prev.fieldValues, defaultValue);
        };
        Object.defineProperty(ViewUpdate.prototype, "viewportChanged", {
            get: function () {
                return this.prev.viewport.eq(this.view.viewport);
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(ViewUpdate.prototype, "docChanged", {
            get: function () {
                return this.transactions.some(function (tr) { return tr.docChanged; });
            },
            enumerable: true,
            configurable: true
        });
        ViewUpdate.prototype.getMeta = function (type) {
            for (var i = this.transactions.length; i >= 0; i--) {
                var found = i == this.transactions.length ? Slot.get(type, this.metadata) : this.transactions[i].getMeta(type);
                if (found !== undefined)
                    return found;
            }
            return undefined;
        };
        return ViewUpdate;
    }());
    function getField(field, fields, values, defaultValue) {
        var index = fields.indexOf(field);
        if (index < 0) {
            if (defaultValue === undefined)
                throw new RangeError("Field isn't present");
            else
                return defaultValue;
        }
        if (index >= values.length)
            throw new RangeError("Accessing a field that isn't initialized yet");
        return values[index];
    }

    var none$5 = [];
    var DocView = /** @class */ (function (_super) {
        __extends(DocView, _super);
        function DocView(view, onDOMChange) {
            var _this = _super.call(this) || this;
            _this.view = view;
            _this.children = [];
            _this.viewports = none$5;
            _this.selectionDirty = null;
            _this.forceSelectionUpdate = false;
            _this.heightOracle = new HeightOracle;
            _this.layoutCheckScheduled = -1;
            // A document position that has to be scrolled into view at the next layout check
            _this.scrollIntoView = -1;
            _this.composing = 0 /* no */;
            _this.composition = null;
            _this.composeTimeout = -1;
            _this.paddingTop = 0;
            _this.paddingBottom = 0;
            _this.setDOM(view.contentDOM);
            _this.viewportState = new ViewportState;
            _this.observer = new DOMObserver(_this, onDOMChange, function () { return _this.checkLayout(); });
            return _this;
        }
        Object.defineProperty(DocView.prototype, "length", {
            get: function () { return this.state.doc.length; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(DocView.prototype, "state", {
            get: function () { return this.view.state; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(DocView.prototype, "viewport", {
            get: function () { return this.view.viewport; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(DocView.prototype, "childGap", {
            get: function () { return 1; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(DocView.prototype, "root", {
            get: function () { return this.view.root; },
            enumerable: true,
            configurable: true
        });
        DocView.prototype.init = function (state) {
            var _this = this;
            var changedRanges = [new ChangedRange(0, 0, 0, state.doc.length)];
            this.heightMap = HeightMap.empty().applyChanges(none$5, this.heightOracle.setDoc(state.doc), changedRanges);
            this.children = [];
            this.viewports = this.decorations = none$5;
            var contentChanges = this.computeUpdate(none$5, state, none$5, changedRanges, 0, -1);
            this.updateInner(contentChanges, 0);
            this.cancelLayoutCheck();
            this.layoutCheckScheduled = requestAnimationFrame(function () { return _this.checkLayout(); });
        };
        // Update the document view to a given state. scrollIntoView can be
        // used as a hint to compute a new viewport that includes that
        // position, if we know the editor is going to scroll that position
        // into view.
        DocView.prototype.update = function (transactions, state, metadata, scrollIntoView) {
            // FIXME need some way to stabilize viewport—if a change causes the
            // top of the visible viewport to move, scroll position should be
            // adjusted to keep the content in place
            var _this = this;
            if (scrollIntoView === void 0) { scrollIntoView = -1; }
            var prevLen = this.state.doc.length;
            var changes = transactions.length == 1 ? transactions[0].changes :
                transactions.reduce(function (chs, tr) { return chs.appendSet(tr.changes); }, ChangeSet.empty);
            var changedRanges = changes.changedRanges();
            // When the DOM nodes around the selection are moved to another
            // parent, Chrome sometimes reports a different selection through
            // getSelection than the one that it actually shows to the user.
            // This forces a selection update when lines are joined to work
            // around that. Issue #54
            if (browser.chrome && !this.composition && changes.changes.some(function (ch) { return ch.text.length > 1; }))
                this.forceSelectionUpdate = true;
            this.heightMap = this.heightMap.applyChanges(none$5, this.heightOracle.setDoc(state.doc), changedRanges);
            var contentChanges = this.computeUpdate(transactions, state, metadata, changedRanges, 0, scrollIntoView);
            if (this.dirty == 0 /* not */ && contentChanges.length == 0 &&
                this.state.selection.primary.from >= this.viewport.from &&
                this.state.selection.primary.to <= this.viewport.to) {
                this.updateSelection();
                if (scrollIntoView > -1)
                    this.scrollPosIntoView(scrollIntoView);
            }
            else {
                this.updateInner(contentChanges, prevLen);
                this.cancelLayoutCheck();
                if (scrollIntoView > -1)
                    this.scrollIntoView = scrollIntoView;
                this.layoutCheckScheduled = requestAnimationFrame(function () { return _this.checkLayout(); });
            }
        };
        // Used both by update and checkLayout do perform the actual DOM
        // update
        DocView.prototype.updateInner = function (changes, oldLength) {
            var _this = this;
            changes = this.commitComposition(changes);
            var visible = this.viewport, viewports = [visible];
            var _a = this.state.selection.primary, head = _a.head, anchor = _a.anchor;
            if (head < visible.from || head > visible.to)
                viewports.push(this.heightMap.lineViewport(head, this.state.doc));
            if (!viewports.some(function (_a) {
                var from = _a.from, to = _a.to;
                return anchor >= from && anchor <= to;
            }))
                viewports.push(this.heightMap.lineViewport(anchor, this.state.doc));
            viewports.sort(function (a, b) { return a.from - b.from; });
            var compositionRange = null;
            // FIXME changes also contains decoration changes, so this could
            // interrupt compositions due to styling updates (such as highlighting)
            // FIXME we do want to interrupt compositions when they overlap
            // with collapsed decorations (not doing so will break rendering
            // code further down, since the decorations aren't drawn in one piece)
            if (this.composition && this.composition.rootView == this) {
                var from_1 = this.composition.posAtStart, to_1 = from_1 + this.composition.length;
                var newFrom = ChangedRange.mapPos(from_1, -1, changes), newTo = ChangedRange.mapPos(to_1, 1, changes);
                if (changes.length == 0 || changes.length == 1 &&
                    changes[0].fromA >= from_1 && changes[0].toA <= to_1 &&
                    this.composition.textDOM.nodeValue == this.state.doc.slice(newFrom, newTo)) {
                    // No change, or the change falls entirely inside the
                    // composition and the new text corresponds to what the
                    // composition DOM contains
                    compositionRange = new ChangedRange(from_1, to_1, from_1, to_1 + (changes.length ? changes[0].lenDiff : 0));
                }
                else if (changes.every(function (ch) { return ch.fromA >= to_1 || ch.toA <= from_1; })) {
                    // Entirely outside
                    compositionRange = new ChangedRange(from_1, to_1, newFrom, newFrom + (to_1 - from_1));
                }
                else {
                    // Overlaps with the composition, must make sure it is
                    // overwritten so that we get rid of the node
                    changes = new ChangedRange(from_1, to_1, newFrom, newTo).addToSet(changes.slice());
                    this.composition = null;
                }
            }
            this.updateParts(changes, viewports, compositionRange, oldLength);
            this.viewports = viewports;
            this.observer.ignore(function () {
                // Lock the height during redrawing, since Chrome sometimes
                // messes with the scroll position during DOM mutation (though
                // no relayout is triggered and I cannot imagine how it can
                // recompute the scroll position without a layout)
                _this.dom.style.height = _this.heightMap.height + "px";
                _this.sync();
                _this.updateSelection();
                _this.dom.style.height = "";
            });
            if (this.composition && this.composition.rootView != this)
                this.composition = null;
        };
        DocView.prototype.updateParts = function (changes, viewports, compositionRange, oldLength) {
            var _this = this;
            var redraw = rangesToUpdate(this.viewports, viewports, changes, this.length);
            if (compositionRange)
                compositionRange.subtractFromSet(redraw);
            var cursor = new ChildCursor(this.children, oldLength, 1);
            var _loop_1 = function (i, posA) {
                var _a, _b;
                var next = i < 0 ? null : redraw[i], nextA = next ? next.toA : 0;
                if (compositionRange && compositionRange.fromA <= posA && compositionRange.toA >= nextA) {
                    cursor.findPos(nextA); // Must move cursor past the stuff we modify
                    this_1.composition.updateLength(compositionRange.toB - compositionRange.fromB);
                }
                if (!next)
                    return out_posA_1 = posA, "break";
                var fromA = next.fromA, toA = next.toA, fromB = next.fromB, toB = next.toB;
                posA = fromA;
                if (fromA == toA && fromB == toB && !changes.some(function (ch) { return fromB <= ch.toB && toB >= ch.fromB; }))
                    return out_posA_1 = posA, "continue";
                var fromI = void 0, fromOff = void 0, toI, toOff = void 0;
                if (toA == oldLength) {
                    toI = this_1.children.length;
                    toOff = -1;
                }
                else
                    (_a = cursor.findPos(toA), toI = _a.i, toOff = _a.off);
                if (fromA == 0) {
                    fromI = 0;
                    fromOff = -1;
                }
                else
                    (_b = cursor.findPos(fromA), fromI = _b.i, fromOff = _b.off);
                var searchGap = fromI, content = this_1.contentBetween(fromB, toB, viewports, function (from, to) {
                    var height = _this.heightAt(to, 1) - _this.heightAt(from, -1);
                    while (searchGap < toI) {
                        var ch = _this.children[searchGap++];
                        if (ch instanceof GapView)
                            return ch.update(to - from, height);
                    }
                    return new GapView(to - from, height);
                });
                // If the range starts at the start of the document but both
                // the current content and the new content start with a line
                // view, reuse that to avoid a needless DOM reset.
                if (fromOff == -1 && this_1.children[fromI] instanceof LineView && content[0] instanceof LineView)
                    fromOff = 0;
                if (toOff == -1 && toI > 0 && this_1.children[toI - 1] instanceof LineView &&
                    content[content.length - 1] instanceof LineView)
                    toOff = this_1.children[--toI].length;
                if (compositionRange && toOff > -1 && this_1.composition.parent == this_1.children[toI])
                    this_1.children[toI].transferDOM(content[content.length - 1]);
                this_1.replaceRange(fromI, fromOff, toI, toOff, content);
                out_posA_1 = posA;
            };
            var this_1 = this, out_posA_1;
            for (var i = redraw.length - 1, posA = this.length;; i--) {
                var state_1 = _loop_1(i, posA);
                posA = out_posA_1;
                if (state_1 === "break")
                    break;
            }
        };
        DocView.prototype.contentBetween = function (from, to, viewports, mkGap) {
            var result = [];
            for (var i = 0, pos = 0; pos <= to; i++) {
                var next = i < viewports.length ? viewports[i] : null;
                var start = next ? next.from : this.length;
                if (pos < to && start > from)
                    // Gap are always entirely in range because of the way this is
                    // called (between unchanged slices of text)
                    result.push(mkGap(pos + (i > 0 ? 1 : 0), start - (next ? 1 : 0)));
                if (!next)
                    break;
                var vpFrom = Math.max(from, next.from), vpTo = Math.min(to, next.to);
                if (vpFrom <= vpTo) {
                    var content = ContentBuilder.build(this.state.doc, vpFrom, vpTo, this.decorations);
                    if (result.length == 0)
                        result = content;
                    else
                        for (var _i = 0, content_1 = content; _i < content_1.length; _i++) {
                            var line = content_1[_i];
                            result.push(line);
                        }
                }
                pos = next.to;
            }
            return result;
        };
        // Update a range by replacing it with new content. The caller is
        // responsible for making sure that the inserted content 'fits'—that
        // nodes on the sides match the type (gap or line) of the existing
        // nodes there.
        // When *Off is -1, that means "this points at the position before
        // *I, not actually into an existing node"
        DocView.prototype.replaceRange = function (fromI, fromOff, toI, toOff, content) {
            var start = fromOff > -1 ? this.children[fromI] : null;
            if (start && fromI == toI && content.length == 1) { // Change within single child
                start.merge(fromOff, toOff, content[0], fromOff == 0, this.composition);
            }
            else {
                var end = toOff > -1 ? this.children[toI] : null;
                if (end) {
                    var cLast = content[content.length - 1], endPart = end;
                    if (toOff > 0 || fromI == toI) {
                        endPart = end.split(toOff);
                        if (fromI != toI)
                            end.transferDOM(endPart);
                    }
                    cLast.merge(cLast.length, cLast.length, endPart, false, this.composition);
                    toI++;
                }
                if (start) {
                    start.merge(fromOff, start.length, content[0], fromOff == 0, this.composition);
                    fromI++;
                    content.shift();
                }
                if (fromI < toI || content.length)
                    this.replaceChildren(fromI, toI, content);
            }
        };
        // Sync the DOM selection to this.state.selection
        DocView.prototype.updateSelection = function (takeFocus) {
            if (takeFocus === void 0) { takeFocus = false; }
            this.clearSelectionDirty();
            if (!takeFocus && this.root.activeElement != this.dom)
                return;
            var primary = this.state.selection.primary;
            var anchor = this.domFromPos(primary.anchor);
            var head = this.domFromPos(primary.head);
            var domSel = this.root.getSelection();
            // If the selection is already here, or in an equivalent position, don't touch it
            if (!this.forceSelectionUpdate &&
                isEquivalentPosition(anchor.node, anchor.offset, domSel.anchorNode, domSel.anchorOffset) &&
                isEquivalentPosition(head.node, head.offset, domSel.focusNode, domSel.focusOffset))
                return;
            this.forceSelectionUpdate = false;
            this.observer.ignore(function () {
                var _a;
                // Selection.extend can be used to create an 'inverted' selection
                // (one where the focus is before the anchor), but not all
                // browsers support it yet.
                if (domSel.extend) {
                    domSel.collapse(anchor.node, anchor.offset);
                    if (!primary.empty)
                        domSel.extend(head.node, head.offset);
                }
                else {
                    var range = document.createRange();
                    if (primary.anchor > primary.head)
                        _a = [head, anchor], anchor = _a[0], head = _a[1];
                    range.setEnd(head.node, head.offset);
                    range.setStart(anchor.node, anchor.offset);
                    domSel.removeAllRanges();
                    domSel.addRange(range);
                }
            });
        };
        DocView.prototype.heightAt = function (pos, bias) {
            return this.heightMap.heightAt(pos, this.state.doc, bias) + this.paddingTop;
        };
        DocView.prototype.lineAtHeight = function (height) {
            return this.heightMap.lineAt(height - this.paddingTop, this.state.doc);
        };
        // Compute the new viewport and set of decorations, while giving
        // plugin views the opportunity to respond to state and viewport
        // changes. Might require more than one iteration to become stable.
        // Passing update == null means the state didn't change
        DocView.prototype.computeUpdate = function (transactions, state, metadata, contentChanges, bias, scrollIntoView) {
            if (contentChanges === void 0) { contentChanges = none$5; }
            for (var i = 0;; i++) {
                var viewport = this.viewportState.getViewport(state.doc, this.heightMap, bias, scrollIntoView);
                var viewportChange = this.viewport ? !viewport.eq(this.viewport) : true;
                // After 5 tries, or when the viewport is stable and no more iterations are needed, return
                if (i == 5 || !(viewportChange || transactions.length || metadata.length)) {
                    if (i == 5)
                        console.warn("Viewport and decorations failed to converge");
                    return contentChanges;
                }
                var prevState = this.state || state;
                this.view.updateStateInner(state, viewport, transactions, metadata);
                var decorations = this.view.getEffect(ViewField.decorationEffect);
                // If the decorations are stable, stop.
                if (transactions.length == 0 && sameArray(decorations, this.decorations))
                    return contentChanges;
                // Compare the decorations (between document changes)
                var _a = decoChanges(transactions.length ? contentChanges : none$5, decorations, this.decorations, prevState.doc), content = _a.content, height = _a.height;
                this.decorations = decorations;
                // Update the heightmap with these changes. If this is the first
                // iteration and the document changed, also include decorations
                // for inserted ranges.
                var heightChanges = extendWithRanges(none$5, height);
                if (transactions.length)
                    heightChanges = extendWithRanges(heightChanges, heightRelevantDecorations(decorations, contentChanges));
                this.heightMap = this.heightMap.applyChanges(decorations, this.heightOracle, heightChanges);
                // Accumulate content changes so that they can be redrawn
                contentChanges = extendWithRanges(contentChanges, content);
                // Make sure only one iteration is marked as required / state changing
                transactions = metadata = none$5;
            }
        };
        DocView.prototype.focus = function () {
            this.updateSelection(true);
        };
        DocView.prototype.cancelLayoutCheck = function () {
            if (this.layoutCheckScheduled > -1) {
                cancelAnimationFrame(this.layoutCheckScheduled);
                this.layoutCheckScheduled = -1;
            }
        };
        DocView.prototype.forceLayout = function () {
            if (this.layoutCheckScheduled > -1 && !this.view.updating)
                this.checkLayout();
        };
        DocView.prototype.checkLayout = function (forceFull) {
            var _this = this;
            if (forceFull === void 0) { forceFull = false; }
            this.cancelLayoutCheck();
            this.measureVerticalPadding();
            var scrollIntoView = Math.min(this.scrollIntoView, this.state.doc.length);
            this.scrollIntoView = -1;
            var scrollBias = 0;
            if (forceFull)
                this.viewportState.coverEverything();
            else
                scrollBias = this.viewportState.updateFromDOM(this.dom, this.paddingTop);
            if (this.viewportState.top >= this.viewportState.bottom)
                return; // We're invisible!
            var lineHeights = this.measureVisibleLineHeights(), refresh = false;
            if (this.heightOracle.mustRefresh(lineHeights)) {
                var _a = this.measureTextSize(), lineHeight = _a.lineHeight, charWidth = _a.charWidth;
                refresh = this.heightOracle.refresh(getComputedStyle(this.dom).whiteSpace, lineHeight, charWidth, (this.dom).clientWidth / charWidth, lineHeights);
            }
            if (scrollIntoView > -1)
                this.scrollPosIntoView(scrollIntoView);
            this.view.withUpdating(function () {
                var updated = null;
                for (var i = 0;; i++) {
                    _this.heightOracle.heightChanged = false;
                    _this.heightMap = _this.heightMap.updateHeight(_this.heightOracle, 0, refresh, new MeasuredHeights(_this.viewport.from, lineHeights || _this.measureVisibleLineHeights()));
                    var covered = _this.viewportState.coveredBy(_this.state.doc, _this.viewport, _this.heightMap, scrollBias);
                    if (covered && !_this.heightOracle.heightChanged)
                        break;
                    if (!updated)
                        updated = new ViewSnapshot(_this.view);
                    if (i > 10)
                        throw new Error("Layout failed to converge");
                    var contentChanges = covered ? none$5 : _this.computeUpdate(none$5, _this.state, none$5, none$5, scrollBias, -1);
                    _this.updateInner(contentChanges, _this.length);
                    lineHeights = null;
                    refresh = false;
                    scrollBias = 0;
                    _this.viewportState.updateFromDOM(_this.dom, _this.paddingTop);
                }
                if (updated) {
                    _this.observer.listenForScroll();
                    _this.view.updatePlugins(new ViewUpdate(updated, none$5, _this.view, none$5));
                }
            });
        };
        DocView.prototype.scrollPosIntoView = function (pos) {
            var rect = this.coordsAt(pos);
            if (rect)
                scrollRectIntoView(this.dom, rect);
        };
        DocView.prototype.nearest = function (dom) {
            for (var cur = dom; cur;) {
                var domView = cur.cmView;
                if (domView && domView.rootView == this)
                    return domView;
                cur = cur.parentNode;
            }
            return null;
        };
        DocView.prototype.posFromDOM = function (node, offset) {
            var view = this.nearest(node);
            if (!view)
                throw new RangeError("Trying to find position for a DOM position outside of the document");
            return view.localPosFromDOM(node, offset) + view.posAtStart;
        };
        DocView.prototype.domFromPos = function (pos) {
            var _a = new ChildCursor(this.children, this.length, 1).findPos(pos), i = _a.i, off = _a.off;
            return this.children[i].domFromPos(off);
        };
        DocView.prototype.measureVisibleLineHeights = function () {
            var result = [], _a = this.viewport, from = _a.from, to = _a.to;
            for (var pos = 0, i = 0; pos <= to && i < this.children.length; i++) {
                var child = this.children[i];
                if (pos >= from) {
                    result.push(child.dom.getBoundingClientRect().height);
                    var before_1 = 0, after_1 = 0;
                    for (var _i = 0, _b = child.widgets; _i < _b.length; _i++) {
                        var w = _b[_i];
                        var h = w.dom.getBoundingClientRect().height;
                        if (w.side > 0)
                            after_1 += h;
                        else
                            before_1 += h;
                    }
                    if (before_1)
                        result.push(-2, before_1);
                    if (after_1)
                        result.push(-1, after_1);
                }
                pos += child.length + 1;
            }
            return result;
        };
        DocView.prototype.measureVerticalPadding = function () {
            var style = window.getComputedStyle(this.dom);
            this.paddingTop = parseInt(style.paddingTop) || 0;
            this.paddingBottom = parseInt(style.paddingBottom) || 0;
        };
        DocView.prototype.measureTextSize = function () {
            var _this = this;
            for (var _i = 0, _a = this.children; _i < _a.length; _i++) {
                var child = _a[_i];
                if (child instanceof LineView) {
                    var measure = child.measureTextSize();
                    if (measure)
                        return measure;
                }
            }
            // If no workable line exists, force a layout of a measurable element
            var dummy = document.createElement("div"), lineHeight, charWidth;
            dummy.style.cssText = "contain: strict";
            dummy.textContent = "abc def ghi jkl mno pqr stu";
            this.observer.ignore(function () {
                _this.dom.appendChild(dummy);
                var rect = clientRectsFor(dummy.firstChild)[0];
                lineHeight = dummy.getBoundingClientRect().height;
                charWidth = rect ? rect.width / 27 : 7;
                dummy.remove();
            });
            return { lineHeight: lineHeight, charWidth: charWidth };
        };
        DocView.prototype.destroy = function () {
            cancelAnimationFrame(this.layoutCheckScheduled);
            this.observer.destroy();
        };
        DocView.prototype.clearSelectionDirty = function () {
            if (this.selectionDirty != null) {
                cancelAnimationFrame(this.selectionDirty);
                this.selectionDirty = null;
            }
        };
        DocView.prototype.setSelectionDirty = function () {
            var _this = this;
            this.observer.clearSelection();
            if (this.selectionDirty == null)
                this.selectionDirty = requestAnimationFrame(function () { return _this.updateSelection(); });
        };
        DocView.prototype.startComposition = function () {
            var _this = this;
            if (this.composing == 3 /* ending */) {
                this.observer.flush();
                if (this.composing == 3 /* ending */) {
                    clearTimeout(this.composeTimeout);
                    this.exitComposition();
                }
            }
            if (this.composing == 0 /* no */) {
                this.composing = 1 /* starting */;
                this.composeTimeout = setTimeout(function () { return _this.enterComposition(); }, 20);
            }
        };
        DocView.prototype.endComposition = function () {
            var _this = this;
            if (this.composing == 2 /* yes */) {
                this.composing = 3 /* ending */;
                this.composeTimeout = setTimeout(function () { return _this.exitComposition(); }, 20);
            }
            else if (this.composing == 1 /* starting */) {
                clearTimeout(this.composeTimeout);
                this.composing = 0 /* no */;
            }
        };
        DocView.prototype.commitComposition = function (changes) {
            if (this.composing == 1 /* starting */) {
                clearTimeout(this.composeTimeout);
                this.enterComposition();
            }
            else if (this.composing == 3 /* ending */) {
                clearTimeout(this.composeTimeout);
                changes = this.clearComposition(changes);
            }
            return changes;
        };
        DocView.prototype.enterComposition = function () {
            // FIXME schedule a timeout that ends the composition (or at least
            // our view of it) after a given inactive time?
            var _a = this.root.getSelection(), focusNode = _a.focusNode, focusOffset = _a.focusOffset;
            if (focusNode) {
                // Enter adjacent nodes when necessary, looking for a text node
                while (focusNode.nodeType == 1) {
                    if (focusOffset > 0) {
                        focusNode = focusNode.childNodes[focusOffset - 1];
                        focusOffset = maxOffset(focusNode);
                    }
                    else if (focusOffset < focusNode.childNodes.length) {
                        focusNode = focusNode.childNodes[focusOffset];
                        focusOffset = 0;
                    }
                    else {
                        break;
                    }
                }
                var view = this.nearest(focusNode);
                if (view instanceof TextView)
                    this.composition = view.toCompositionView();
                else if (focusNode.nodeType == 3 && view instanceof LineView)
                    this.composition = view.createCompositionViewAround(focusNode);
            }
            this.composing = this.composition ? 2 /* yes */ : 0 /* no */;
        };
        // Remove this.composition, if present, and set this.composing to
        // no. Return a range that covers the composition's extent (which'll
        // have to be redrawn to turn it into regular view nodes) when a
        // composition was removed.
        DocView.prototype.clearComposition = function (changes) {
            var composition = this.composition;
            this.composition = null;
            this.composing = 0 /* no */;
            if (composition && composition.rootView == this) {
                var from = composition.posAtStart, to = from + composition.length;
                changes = new ChangedRange(from, to, ChangedRange.mapPos(from, -1, changes), ChangedRange.mapPos(to, 1, changes)).addToSet(changes.slice());
            }
            return changes;
        };
        DocView.prototype.exitComposition = function () {
            var _this = this;
            var ranges = this.clearComposition(none$5);
            if (ranges.length)
                this.observer.ignore(function () {
                    _this.updateInner(ranges, _this.length);
                });
        };
        return DocView;
    }(ContentView));
    // Browsers appear to reserve a fixed amount of bits for height
    // styles, and ignore or clip heights above that. For Chrome and
    // Firefox, this is in the 20 million range, so we try to stay below
    // that.
    var MAX_NODE_HEIGHT = 1e7;
    var GapView = /** @class */ (function (_super) {
        __extends(GapView, _super);
        function GapView(length, height) {
            var _this = _super.call(this) || this;
            _this.length = length;
            _this.height = height;
            return _this;
        }
        Object.defineProperty(GapView.prototype, "children", {
            get: function () { return none$5; },
            enumerable: true,
            configurable: true
        });
        GapView.prototype.update = function (length, height) {
            this.length = length;
            if (this.height != height) {
                this.height = height;
                this.markDirty();
            }
            return this;
        };
        GapView.prototype.syncInto = function (parent, pos) {
            if (!this.dom) {
                this.setDOM(document.createElement("div"));
                this.dom.contentEditable = "false";
            }
            return _super.prototype.syncInto.call(this, parent, pos);
        };
        GapView.prototype.sync = function () {
            if (this.dirty) {
                if (this.height < MAX_NODE_HEIGHT) {
                    this.dom.style.height = this.height + "px";
                    while (this.dom.firstChild)
                        this.dom.firstChild.remove();
                }
                else {
                    this.dom.style.height = "";
                    while (this.dom.firstChild)
                        this.dom.firstChild.remove();
                    for (var remaining = this.height; remaining > 0; remaining -= MAX_NODE_HEIGHT) {
                        var elt = this.dom.appendChild(document.createElement("div"));
                        elt.style.height = Math.min(remaining, MAX_NODE_HEIGHT) + "px";
                    }
                }
                this.dirty = 0 /* not */;
            }
        };
        Object.defineProperty(GapView.prototype, "overrideDOMText", {
            get: function () {
                return this.parent ? this.parent.state.doc.sliceLines(this.posAtStart, this.posAtEnd) : [""];
            },
            enumerable: true,
            configurable: true
        });
        GapView.prototype.domBoundsAround = function () { return null; };
        return GapView;
    }(ContentView));
    function decoChanges(diff, decorations, oldDecorations, oldDoc) {
        var contentRanges = [], heightRanges = [];
        for (var i = decorations.length - 1; i >= 0; i--) {
            var deco = decorations[i], oldDeco = i < oldDecorations.length ? oldDecorations[i] : Decoration.none;
            if (deco.size == 0 && oldDeco.size == 0)
                continue;
            var newRanges = findChangedRanges(oldDeco, deco, diff, oldDoc);
            contentRanges = joinRanges(contentRanges, newRanges.content);
            heightRanges = joinRanges(heightRanges, newRanges.height);
        }
        return { content: contentRanges, height: heightRanges };
    }
    function extendWithRanges(diff, ranges) {
        var result = [];
        for (var dI = 0, rI = 0, posA = 0, posB = 0;; dI++) {
            var next = dI == diff.length ? null : diff[dI], off = posA - posB;
            var end = next ? next.fromB : 2e9;
            while (rI < ranges.length && ranges[rI] < end) {
                var from = ranges[rI], to = ranges[rI + 1];
                var fromB = Math.max(posB, from), toB = Math.min(end, to);
                if (fromB <= toB)
                    new ChangedRange(fromB + off, toB + off, fromB, toB).addToSet(result);
                if (to > end)
                    break;
                else
                    rI += 2;
            }
            if (!next)
                return result;
            new ChangedRange(next.fromA, next.toA, next.fromB, next.toB).addToSet(result);
            posA = next.toA;
            posB = next.toB;
        }
    }
    function sameArray(a, b) {
        if (a.length != b.length)
            return false;
        for (var i = 0; i < a.length; i++)
            if (a[i] !== b[i])
                return false;
        return true;
    }
    function nextRange(viewports, pos) {
        for (var i = 0; i < viewports.length; i++) {
            var _a = viewports[i], from = _a.from, to = _a.to;
            if (from > pos)
                return [false, from];
            if (to > pos)
                return [true, to];
        }
        return [false, 2e9];
    }
    // Grows a set of ranges to include anything that wasn't drawn (as
    // lines) in both the old and new viewports.
    function rangesToUpdate(vpA, vpB, changes, lenB) {
        for (var i = 0, posA = 0, posB = 0, found = [];; i++) {
            var change = i < changes.length ? changes[i] : null;
            var nextB = change ? change.fromB : lenB;
            // Unchanged range posB to nextB
            while (posB < nextB) {
                var _a = nextRange(vpA, posA), insideA = _a[0], toA = _a[1], _b = nextRange(vpB, posB), insideB = _b[0], toB = _b[1];
                var newB = Math.min(nextB, posB + (toA - posA), toB), newA = posA + (newB - posB);
                if (!insideA || !insideB)
                    new ChangedRange(posA, newA, posB, newB).addToSet(found);
                posA = newA;
                posB = newB;
            }
            if (!change)
                return found;
            change.addToSet(found);
            posA = change.toA;
            posB = change.toB;
        }
    }

    // FIXME rename "word" to something more descriptive of what it actually does?
    function movePos(view, start, direction, granularity, action) {
        if (granularity === void 0) { granularity = "character"; }
        var sel = view.root.getSelection();
        var context = LineContext.get(view, start);
        var dir = direction == "forward" || direction == "right" ? 1 : -1;
        // Can only query native behavior when Selection.modify is
        // supported, the cursor is well inside the rendered viewport, and
        // we're not doing by-line motion on Gecko (which will mess up goal
        // column motion)
        if (sel.modify && context && !context.nearViewportEnd(view) && view.hasFocus() &&
            granularity != "word" &&
            !(granularity == "line" && (browser.gecko || view.state.selection.ranges.length > 1))) {
            return view.docView.observer.ignore(function () {
                var prepared = context.prepareForQuery(view, start);
                var startDOM = view.docView.domFromPos(start);
                var equiv = (!browser.chrome || prepared.lines.length == 0) &&
                    isEquivalentPosition(startDOM.node, startDOM.offset, sel.focusNode, sel.focusOffset) && false;
                // Firefox skips an extra character ahead when extending across
                // an uneditable element (but not when moving)
                if (prepared.atWidget && browser.gecko && action == "extend")
                    action = "move";
                if (action == "move" && !(equiv && sel.isCollapsed))
                    sel.collapse(startDOM.node, startDOM.offset);
                else if (action == "extend" && !equiv)
                    sel.extend(startDOM.node, startDOM.offset);
                sel.modify(action, direction, granularity);
                view.docView.setSelectionDirty();
                var result = view.docView.posFromDOM(sel.focusNode, sel.focusOffset);
                context.undoQueryPreparation(view, prepared);
                return result;
            });
        }
        else if (granularity == "character") {
            return moveCharacterSimple(start, dir, context, view.state.doc);
        }
        else if (granularity == "lineboundary") {
            if (context)
                return context.start + (dir < 0 ? 0 : context.line.length);
            var line = view.state.doc.lineAt(start);
            return dir < 0 ? line.start : line.end;
        }
        else if (granularity == "line") {
            if (context && !context.nearViewportEnd(view, dir)) {
                var startCoords = view.docView.coordsAt(start);
                var goal = getGoalColumn(view, start, startCoords.left);
                for (var startY = dir < 0 ? startCoords.top : startCoords.bottom, dist = 5; dist < 50; dist += 10) {
                    var pos = posAtCoords(view, { x: goal.column, y: startY + dist * dir }, dir);
                    if (pos < 0)
                        break;
                    if (pos != start) {
                        goal.pos = pos;
                        return pos;
                    }
                }
            }
            // Can't do a precise one based on DOM positions, fall back to per-column
            return moveLineByColumn(view.state.doc, view.state.tabSize, start, dir);
        }
        else if (granularity == "word") {
            return moveWord(view, start, direction);
        }
        else {
            throw new RangeError("Invalid move granularity: " + granularity);
        }
    }
    function moveLineByColumn(doc, tabSize, pos, dir) {
        var line = doc.lineAt(pos);
        // FIXME also needs goal column?
        var col = 0;
        for (var iter = doc.iterRange(line.start, pos); !iter.next().done;)
            col = countColumn(iter.value, col, tabSize);
        if (dir < 0 && line.start == 0)
            return 0;
        else if (dir > 0 && line.end == doc.length)
            return line.end;
        var otherLine = doc.line(line.number + dir);
        var result = otherLine.start;
        var seen = 0;
        for (var iter = doc.iterRange(otherLine.start, otherLine.end); seen >= col && !iter.next().done;) {
            var _a = findColumn(iter.value, seen, col, tabSize), offset = _a.offset, leftOver = _a.leftOver;
            seen = col - leftOver;
            result += offset;
        }
        return result;
    }
    function moveCharacterSimple(start, dir, context, doc) {
        if (context == null) {
            for (var pos = start;; pos += dir) {
                if (pos == 0 || pos == doc.length)
                    return pos;
                if (!isExtendingChar((dir < 0 ? doc.slice(pos - 1, pos) : doc.slice(pos, pos + 1)))) {
                    if (dir < 0)
                        return pos - 1;
                    else if (pos != start)
                        return pos;
                }
            }
        }
        for (var _a = context.line.childPos(start - context.start), i = _a.i, off = _a.off, children = context.line.children, pos = start;;) {
            if (off == (dir < 0 || i == children.length ? 0 : children[i].length)) {
                i += dir;
                if (i < 0 || i >= children.length) // End/start of line
                    return Math.max(0, Math.min(doc.length, pos + (start == pos ? dir : 0)));
                off = dir < 0 ? children[i].length : 0;
            }
            var inline = children[i];
            if (inline instanceof TextView) {
                if (!isExtendingChar(inline.text.charAt(off - (dir < 0 ? 1 : 0)))) {
                    if (dir < 0)
                        return pos - 1;
                    else if (pos != start)
                        return pos;
                }
                off += dir;
                pos += dir;
            }
            else if (inline.length > 0) {
                return pos - off + (dir < 0 ? 0 : inline.length);
            }
        }
    }
    function moveWord(view, start, direction) {
        var doc = view.state.doc;
        for (var pos = start, i = 0;; i++) {
            var next = movePos(view, pos, direction, "character", "move");
            if (next == pos)
                return pos; // End of document
            if (doc.sliceLines(Math.min(next, pos), Math.max(next, pos)).length > 1)
                return next; // Crossed a line boundary
            var group = SelectionRange.groupAt(view.state, next, next > pos ? -1 : 1);
            var away = pos < group.from && pos > group.to;
            // If the group is away from its start position, we jumped over a
            // bidi boundary, and should take the side closest (in index
            // coordinates) to the start position
            var start_1 = away ? pos < group.head : group.from == pos ? false : group.to == pos ? true : next < pos;
            pos = start_1 ? group.from : group.to;
            if (i > 0 || /\S/.test(doc.slice(group.from, group.to)))
                return pos;
            next = Math.max(0, Math.min(doc.length, pos + (start_1 ? -1 : 1)));
        }
    }
    function getGoalColumn(view, pos, column) {
        for (var _i = 0, _a = view.inputState.goalColumns; _i < _a.length; _i++) {
            var goal_1 = _a[_i];
            if (goal_1.pos == pos)
                return goal_1;
        }
        var goal = { pos: 0, column: column };
        view.inputState.goalColumns.push(goal);
        return goal;
    }
    var LineContext = /** @class */ (function () {
        function LineContext(line, start, index) {
            this.line = line;
            this.start = start;
            this.index = index;
        }
        LineContext.get = function (view, pos) {
            for (var i = 0, off = 0;; i++) {
                var line = view.docView.children[i], end = off + line.length;
                if (end >= pos)
                    return line instanceof LineView ? new LineContext(line, off, i) : null;
                off = end + 1;
            }
        };
        LineContext.prototype.nearViewportEnd = function (view, side) {
            if (side === void 0) { side = 0; }
            for (var _i = 0, _a = view.docView.viewports; _i < _a.length; _i++) {
                var _b = _a[_i], from = _b.from, to = _b.to;
                if (from > 0 && from == this.start && side <= 0 ||
                    to < view.state.doc.length && to == this.start + this.line.length && side >= 0)
                    return true;
            }
            return false;
        };
        // FIXME limit the amount of work in character motion in non-bidi
        // context? or not worth it?
        LineContext.prototype.prepareForQuery = function (view, pos) {
            var linesToSync = [], atWidget = false;
            function maybeHide(view) {
                if (!(view instanceof TextView))
                    atWidget = true;
                if (view.length > 0)
                    return false;
                view.dom.remove();
                if (linesToSync.indexOf(view.parent) < 0)
                    linesToSync.push(view.parent);
                return true;
            }
            var _a = this.line.childPos(pos - this.start), i = _a.i, off = _a.off;
            if (off == 0) {
                for (var j = i; j < this.line.children.length; j++)
                    if (!maybeHide(this.line.children[j]))
                        break;
                for (var j = i; j > 0; j--)
                    if (!maybeHide(this.line.children[j - 1]))
                        break;
            }
            function addForLine(line, omit) {
                if (omit === void 0) { omit = -1; }
                if (line.children.length == 0)
                    return;
                for (var i_1 = 0, off_1 = 0; i_1 <= line.children.length; i_1++) {
                    var next = i_1 == line.children.length ? null : line.children[i_1];
                    if ((!next || !(next instanceof TextView)) && off_1 != omit &&
                        (i_1 == 0 || !(line.children[i_1 - 1] instanceof TextView))) {
                        line.dom.insertBefore(document.createTextNode("\u200b"), next ? next.dom : null);
                        if (linesToSync.indexOf(line) < 0)
                            linesToSync.push(line);
                    }
                    if (next)
                        off_1 += next.length;
                }
            }
            if (this.index > 0)
                addForLine(this.line.parent.children[this.index - 1]);
            addForLine(this.line, pos - this.start);
            if (this.index < this.line.parent.children.length - 1)
                addForLine(this.line.parent.children[this.index + 1]);
            return { lines: linesToSync, atWidget: atWidget };
        };
        LineContext.prototype.undoQueryPreparation = function (view, toSync) {
            for (var _i = 0, _a = toSync.lines; _i < _a.length; _i++) {
                var line = _a[_i];
                line.syncDOMChildren();
            }
        };
        return LineContext;
    }());
    // Search the DOM for the {node, offset} position closest to the given
    // coordinates. Very inefficient and crude, but can usually be avoided
    // by calling caret(Position|Range)FromPoint instead.
    // FIXME holding arrow-up/down at the end of the viewport is a rather
    // common use case that will repeatedly trigger this code. Maybe
    // introduce some element of binary search after all?
    function getdx(x, rect) {
        return rect.left > x ? rect.left - x : Math.max(0, x - rect.right);
    }
    function getdy(y, rect) {
        return rect.top > y ? rect.top - y : Math.max(0, y - rect.bottom);
    }
    function yOverlap(a, b) {
        return a.top < b.bottom - 1 && a.bottom > b.top + 1;
    }
    function upTop(rect, top) {
        return top < rect.top ? { top: top, left: rect.left, right: rect.right, bottom: rect.bottom } : rect;
    }
    function upBot(rect, bottom) {
        return bottom > rect.bottom ? { top: rect.top, left: rect.left, right: rect.right, bottom: bottom } : rect;
    }
    function domPosAtCoords(parent, x, y) {
        var closest, closestRect, closestX, closestY;
        var above, below, aboveRect, belowRect;
        for (var child = parent.firstChild; child; child = child.nextSibling) {
            var rects = clientRectsFor(child);
            for (var i = 0; i < rects.length; i++) {
                var rect = rects[i];
                if (closestRect && yOverlap(closestRect, rect))
                    rect = upTop(upBot(rect, closestRect.bottom), closestRect.top);
                var dx = getdx(x, rect), dy = getdy(y, rect);
                if (dx == 0 && dy == 0)
                    return child.nodeType == 3 ? domPosInText(child, x, y) : domPosAtCoords(child, x, y);
                if (!closest || closestY > dy || closestY == dy && closestX > dx) {
                    closest = child;
                    closestRect = rect;
                    closestX = dx;
                    closestY = dy;
                }
                if (dx == 0) {
                    if (y > rect.bottom && (!aboveRect || aboveRect.bottom < rect.bottom)) {
                        above = child;
                        aboveRect = rect;
                    }
                    else if (y < rect.top && (!belowRect || belowRect.top > rect.top)) {
                        below = child;
                        belowRect = rect;
                    }
                }
                else if (aboveRect && yOverlap(aboveRect, rect)) {
                    aboveRect = upBot(aboveRect, rect.bottom);
                }
                else if (belowRect && yOverlap(belowRect, rect)) {
                    belowRect = upTop(belowRect, rect.top);
                }
            }
        }
        if (aboveRect && aboveRect.bottom >= y) {
            closest = above;
            closestRect = aboveRect;
        }
        else if (belowRect && belowRect.top <= y) {
            closest = below;
            closestRect = belowRect;
        }
        if (!closest)
            return { node: parent, offset: 0 };
        var clipX = Math.max(closestRect.left, Math.min(closestRect.right, x));
        if (closest.nodeType == 3)
            return domPosInText(closest, clipX, y);
        if (!closestX && closest.contentEditable == "true")
            domPosAtCoords(closest, clipX, y);
        var offset = Array.prototype.indexOf.call(parent.childNodes, closest) +
            (x >= (closestRect.left + closestRect.right) / 2 ? 1 : 0);
        return { node: parent, offset: offset };
    }
    function domPosInText(node, x, y) {
        var len = node.nodeValue.length, range = document.createRange();
        for (var i = 0; i < len; i++) {
            range.setEnd(node, i + 1);
            range.setStart(node, i);
            var rects = range.getClientRects();
            for (var j = 0; j < rects.length; j++) {
                var rect = rects[j];
                if (rect.top == rect.bottom)
                    continue;
                if (rect.left - 1 <= x && rect.right + 1 >= x &&
                    rect.top - 1 <= y && rect.bottom + 1 >= y) {
                    var right = x >= (rect.left + rect.right) / 2, after_1 = right;
                    if (browser.chrome || browser.gecko) {
                        // Check for RTL on browsers that support getting client
                        // rects for empty ranges.
                        range.setEnd(node, i);
                        var rectBefore = range.getBoundingClientRect();
                        if (rectBefore.left == rect.right)
                            after_1 = !right;
                    }
                    return { node: node, offset: i + (after_1 ? 1 : 0) };
                }
            }
        }
        return { node: node, offset: 0 };
    }
    function posAtCoords(view, _a, bias) {
        var x = _a.x, y = _a.y;
        if (bias === void 0) { bias = -1; }
        var _b;
        var content = view.contentDOM.getBoundingClientRect(), heightLine;
        for (;;) {
            heightLine = view.lineAtHeight(y - content.top);
            if (heightLine.textTop > 0) {
                if (bias > 0)
                    y += heightLine.textTop + 1;
                else if (heightLine.start > 0) {
                    y += heightLine.top - 1;
                    continue;
                }
            }
            else if (heightLine.textBottom < 0) {
                if (bias < 0)
                    y += heightLine.textBottom - 1;
                else if (heightLine.end < view.state.doc.length) {
                    y += heightLine.bottom + 1;
                    continue;
                }
            }
            break;
        }
        var lineStart = heightLine.start;
        // If this is outside of the rendered viewport, we can't determine a position
        if (lineStart < view.viewport.from)
            return view.viewport.from == 0 ? 0 : -1;
        if (lineStart > view.viewport.to)
            return view.viewport.to == view.state.doc.length ? view.state.doc.length : -1;
        // Clip x to the viewport sides
        x = Math.max(content.left + 1, Math.min(content.right - 1, x));
        var root = view.root, element = root.elementFromPoint(x, y);
        // There's visible editor content under the point, so we can try
        // using caret(Position|Range)FromPoint as a shortcut
        var node, offset = -1;
        if (element && view.contentDOM.contains(element) && !(view.docView.nearest(element) instanceof WidgetView)) {
            if (root.caretPositionFromPoint) {
                var pos = root.caretPositionFromPoint(x, y);
                if (pos)
                    (node = pos.offsetNode, offset = pos.offset);
            }
            else if (root.caretRangeFromPoint) {
                var range = root.caretRangeFromPoint(x, y);
                if (range)
                    (node = range.startContainer, offset = range.startOffset);
            }
        }
        // No luck, do our own (potentially expensive) search
        if (!node) {
            var line = LineContext.get(view, lineStart).line;
            (_b = domPosAtCoords(line.dom, x, y), node = _b.node, offset = _b.offset);
        }
        return view.docView.posFromDOM(node, offset);
    }

    // This will also be where dragging info and such goes
    var InputState = /** @class */ (function () {
        function InputState(view) {
            var _this = this;
            this.lastKeyCode = 0;
            this.lastKeyTime = 0;
            this.lastSelectionOrigin = null;
            this.lastSelectionTime = 0;
            this.registeredEvents = [];
            this.goalColumns = [];
            this.mouseSelection = null;
            var _loop_1 = function (type) {
                var handler = handlers[type];
                view.contentDOM.addEventListener(type, function (event) {
                    if (!eventBelongsToEditor(view, event))
                        return;
                    if (_this.runCustomHandlers(type, view, event))
                        event.preventDefault();
                    else
                        handler(view, event);
                });
                this_1.registeredEvents.push(type);
            };
            var this_1 = this;
            for (var type in handlers) {
                _loop_1(type);
            }
            // Must always run, even if a custom handler handled the event
            view.contentDOM.addEventListener("keydown", function (event) {
                view.inputState.lastKeyCode = event.keyCode;
                view.inputState.lastKeyTime = Date.now();
            });
            if (view.root.activeElement == view.contentDOM)
                view.dom.classList.add("codemirror-focused");
            this.customHandlers = customHandlers(view);
            var _loop_2 = function (type) {
                if (this_2.registeredEvents.indexOf(type) < 0) {
                    this_2.registeredEvents.push(type);
                    view.contentDOM.addEventListener(type, function (event) {
                        if (!eventBelongsToEditor(view, event))
                            return;
                        if (_this.runCustomHandlers(type, view, event))
                            event.preventDefault();
                    });
                }
            };
            var this_2 = this;
            for (var type in this.customHandlers) {
                _loop_2(type);
            }
        }
        InputState.prototype.setSelectionOrigin = function (origin) {
            this.lastSelectionOrigin = origin;
            this.lastSelectionTime = Date.now();
        };
        InputState.prototype.runCustomHandlers = function (type, view, event) {
            var handlers = this.customHandlers[type];
            if (handlers)
                for (var _i = 0, handlers_1 = handlers; _i < handlers_1.length; _i++) {
                    var handler = handlers_1[_i];
                    if (handler(view, event) || event.defaultPrevented)
                        return true;
                }
            return false;
        };
        InputState.prototype.startMouseSelection = function (view, event, update) {
            if (this.mouseSelection)
                this.mouseSelection.destroy();
            this.mouseSelection = new MouseSelection(this, view, event, update);
        };
        InputState.prototype.update = function (transactions) {
            if (this.mouseSelection)
                this.mouseSelection.map(transactions.reduce(function (set, tr) { return set.appendSet(tr.changes); }, ChangeSet.empty));
            this.lastKeyCode = this.lastSelectionTime = 0;
        };
        InputState.prototype.destroy = function () {
            if (this.mouseSelection)
                this.mouseSelection.destroy();
        };
        return InputState;
    }());
    var MouseSelection = /** @class */ (function () {
        function MouseSelection(inputState, view, event, update) {
            this.inputState = inputState;
            this.view = view;
            this.update = update;
            var doc = view.contentDOM.ownerDocument;
            doc.addEventListener("mousemove", this.move = this.move.bind(this));
            doc.addEventListener("mouseup", this.up = this.up.bind(this));
            // FIXME make these configurable somehow
            this.extend = event.shiftKey;
            this.multiple = view.state.multipleSelections && (browser.mac ? event.metaKey : event.ctrlKey);
            this.dragMove = !(browser.mac ? event.altKey : event.ctrlKey);
            this.startSelection = view.state.selection;
            var _a = this.queryPos(event), pos = _a.pos, bias = _a.bias;
            this.startPos = this.curPos = pos;
            this.startBias = this.curBias = bias;
            this.dragging = isInPrimarySelection(view, this.startPos, event) ? null : false;
            // When clicking outside of the selection, immediately apply the
            // effect of starting the selection
            if (this.dragging === false) {
                event.preventDefault();
                this.select();
            }
        }
        MouseSelection.prototype.queryPos = function (event) {
            var pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
            var coords = this.view.coordsAtPos(pos);
            var bias = !coords ? 1 :
                coords.top > event.clientY ? -1 :
                    coords.bottom < event.clientY ? 1 :
                        coords.left > event.clientX ? -1 : 1;
            return { pos: pos, bias: bias };
        };
        MouseSelection.prototype.move = function (event) {
            if (event.buttons == 0)
                return this.destroy();
            if (this.dragging !== false)
                return;
            var _a = this.queryPos(event), pos = _a.pos, bias = _a.bias;
            if (pos == this.curPos && bias == this.curBias)
                return;
            this.curPos = pos;
            this.curBias = bias;
            this.select();
        };
        MouseSelection.prototype.up = function (event) {
            if (this.dragging == null)
                this.select();
            this.destroy();
        };
        MouseSelection.prototype.destroy = function () {
            var doc = this.view.contentDOM.ownerDocument;
            doc.removeEventListener("mousemove", this.move);
            doc.removeEventListener("mouseup", this.up);
            this.inputState.mouseSelection = null;
        };
        MouseSelection.prototype.select = function () {
            var selection = this.update(this.view, this.startSelection, this.startPos, this.startBias, this.curPos, this.curBias, this.extend, this.multiple);
            if (!selection.eq(this.view.state.selection))
                this.view.dispatch(this.view.state.transaction.setSelection(selection)
                    .addMeta(Transaction.userEvent("pointer")));
        };
        MouseSelection.prototype.map = function (changes) {
            if (changes.length) {
                this.startSelection = this.startSelection.map(changes);
                this.startPos = changes.mapPos(this.startPos);
                this.curPos = changes.mapPos(this.curPos);
            }
            if (this.dragging)
                this.dragging = this.dragging.map(changes);
        };
        return MouseSelection;
    }());
    function isInPrimarySelection(view, pos, event) {
        var primary = view.state.selection.primary;
        if (primary.empty)
            return false;
        if (pos < primary.from || pos > primary.to)
            return false;
        if (pos > primary.from && pos < primary.to)
            return true;
        // On boundary clicks, check whether the coordinates are inside the
        // selection's client rectangles
        var sel = view.root.getSelection();
        if (sel.rangeCount == 0)
            return true;
        var rects = sel.getRangeAt(0).getClientRects();
        for (var i = 0; i < rects.length; i++) {
            var rect = rects[i];
            if (rect.left <= event.clientX && rect.right >= event.clientX &&
                rect.top <= event.clientY && rect.bottom >= event.clientY)
                return true;
        }
        return false;
    }
    function eventBelongsToEditor(view, event) {
        if (!event.bubbles)
            return true;
        if (event.defaultPrevented)
            return false;
        for (var node = event.target; node != view.contentDOM; node = node.parentNode)
            if (!node || node.nodeType == 11 || (node.cmView && node.cmView.ignoreEvent(event)))
                return false;
        return true;
    }
    function customHandlers(view) {
        var result = Object.create(null);
        for (var _i = 0, _a = view.behavior.get(handleDOMEvents); _i < _a.length; _i++) {
            var handlers_2 = _a[_i];
            for (var eventType in handlers_2)
                (result[eventType] || (result[eventType] = [])).push(handlers_2[eventType]);
        }
        return result;
    }
    var handlers = Object.create(null);
    // This is very crude, but unfortunately both these browsers _pretend_
    // that they have a clipboard API—all the objects and methods are
    // there, they just don't work, and they are hard to test.
    var brokenClipboardAPI = (browser.ie && browser.ie_version < 15) ||
        (browser.ios && browser.webkit_version < 604);
    function capturePaste(view) {
        var doc = view.dom.ownerDocument;
        var target = doc.body.appendChild(doc.createElement("textarea"));
        target.style.cssText = "position: fixed; left: -10000px; top: 10px";
        target.focus();
        setTimeout(function () {
            view.focus();
            doc.body.removeChild(target);
            doPaste(view, target.value);
        }, 50);
    }
    function doPaste(view, text) {
        view.dispatch(view.state.transaction.replaceSelection(text)
            .addMeta(Transaction.userEvent("paste")).scrollIntoView());
    }
    function mustCapture(event) {
        var mods = (event.ctrlKey ? 1 /* ctrl */ : 0) | (event.metaKey ? 8 /* meta */ : 0) |
            (event.altKey ? 2 /* alt */ : 0) | (event.shiftKey ? 4 /* shift */ : 0);
        var code = event.keyCode, macCtrl = browser.mac && mods == 1 /* ctrl */;
        return code == 8 || (macCtrl && code == 72) || // Backspace, Ctrl-h on Mac
            code == 46 || (macCtrl && code == 68) || // Delete, Ctrl-d on Mac
            code == 27 || // Esc
            (mods == (browser.mac ? 8 /* meta */ : 1 /* ctrl */) && // Ctrl/Cmd-[biyz]
                (code == 66 || code == 73 || code == 89 || code == 90));
    }
    handlers.keydown = function (view, event) {
        if (mustCapture(event))
            event.preventDefault();
        view.inputState.setSelectionOrigin("keyboard");
    };
    handlers.touchdown = handlers.touchmove = function (view, event) {
        view.inputState.setSelectionOrigin("pointer");
    };
    handlers.mousedown = function (view, event) {
        if (event.button == 0)
            view.startMouseSelection(event, updateMouseSelection(event.detail));
    };
    function rangeForClick(view, pos, bias, type) {
        if (type == 1) { // Single click
            return new SelectionRange(pos);
        }
        else if (type == 2) { // Double click
            return SelectionRange.groupAt(view.state, pos, bias);
        }
        else { // Triple click
            var context_1 = LineContext.get(view, pos);
            if (context_1)
                return new SelectionRange(context_1.start + context_1.line.length, context_1.start);
            var _a = view.state.doc.lineAt(pos), start = _a.start, end = _a.end;
            return new SelectionRange(start, end);
        }
    }
    function updateMouseSelection(type) {
        return function (view, startSelection, startPos, startBias, curPos, curBias, extend, multiple) {
            var range = rangeForClick(view, curPos, curBias, type);
            if (startPos != curPos && !extend) {
                var startRange = rangeForClick(view, startPos, startBias, type);
                range = range.extend(Math.min(startRange.from, range.from), Math.max(startRange.to, range.to));
            }
            if (extend)
                return startSelection.replaceRange(startSelection.primary.extend(range.from, range.to));
            else if (multiple)
                return startSelection.addRange(range);
            else
                return EditorSelection.create([range]);
        };
    }
    handlers.dragstart = function (view, event) {
        var _a = view.state, doc = _a.doc, primary = _a.selection.primary;
        var mouseSelection = view.inputState.mouseSelection;
        if (mouseSelection)
            mouseSelection.dragging = primary;
        if (event.dataTransfer) {
            event.dataTransfer.setData("Text", doc.slice(primary.from, primary.to));
            event.dataTransfer.effectAllowed = "copyMove";
        }
    };
    handlers.drop = function (view, event) {
        if (!event.dataTransfer)
            return;
        var dropPos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        var text = event.dataTransfer.getData("Text");
        if (dropPos < 0 || !text)
            return;
        event.preventDefault();
        var tr = view.state.transaction;
        var mouseSelection = view.inputState.mouseSelection;
        if (mouseSelection && mouseSelection.dragging && mouseSelection.dragMove) {
            tr = tr.replace(mouseSelection.dragging.from, mouseSelection.dragging.to, "");
            dropPos = tr.changes.mapPos(dropPos);
        }
        var change = new Change(dropPos, dropPos, view.state.splitLines(text));
        tr = tr.change(change)
            .setSelection(EditorSelection.single(dropPos, dropPos + change.length))
            .addMeta(Transaction.userEvent("drop"));
        view.focus();
        view.dispatch(tr);
    };
    handlers.paste = function (view, event) {
        view.docView.observer.flush();
        var data = brokenClipboardAPI ? null : event.clipboardData;
        var text = data && data.getData("text/plain");
        if (text) {
            doPaste(view, text);
            event.preventDefault();
        }
        else {
            capturePaste(view);
        }
    };
    function captureCopy(view, text) {
        // The extra wrapper is somehow necessary on IE/Edge to prevent the
        // content from being mangled when it is put onto the clipboard
        var doc = view.dom.ownerDocument;
        var target = doc.body.appendChild(doc.createElement("textarea"));
        target.style.cssText = "position: fixed; left: -10000px; top: 10px";
        target.value = text;
        target.focus();
        target.selectionEnd = text.length;
        target.selectionStart = 0;
        setTimeout(function () {
            doc.body.removeChild(target);
            view.focus();
        }, 50);
    }
    handlers.copy = handlers.cut = function (view, event) {
        var range = view.state.selection.primary;
        if (range.empty)
            return;
        var data = brokenClipboardAPI ? null : event.clipboardData;
        var text = view.state.joinLines(view.state.doc.sliceLines(range.from, range.to));
        if (data) {
            event.preventDefault();
            data.clearData();
            data.setData("text/plain", text);
        }
        else {
            captureCopy(view, text);
        }
        if (event.type == "cut") {
            view.dispatch(view.state.transaction.replaceSelection([""]).scrollIntoView().addMeta(Transaction.userEvent("cut")));
        }
    };
    handlers.focus = function (view) {
        view.updateState([], view.state, [focusChange(true)]);
    };
    handlers.blur = function (view) {
        view.updateState([], view.state, [focusChange(false)]);
    };
    handlers.beforeprint = function (view) {
        view.docView.checkLayout(true);
    };
    handlers.compositionstart = handlers.compositionupdate = function (view) {
        view.docView.startComposition();
    };
    handlers.compositionend = function (view) {
        view.docView.endComposition();
    };

    var LINE_SEP = "\ufdda"; // A Unicode 'non-character', used to denote newlines internally
    function applyDOMChange(view, start, end, typeOver) {
        var change, newSel;
        var sel = view.state.selection.primary, bounds;
        if (start > -1 && (bounds = view.docView.domBoundsAround(start, end, 0))) {
            var from = bounds.from, to = bounds.to;
            var selPoints = selectionPoints(view.contentDOM, view.root), reader = new DOMReader(selPoints);
            reader.readRange(bounds.startDOM, bounds.endDOM);
            newSel = selectionFromPoints(selPoints, from);
            var preferredPos = sel.from, preferredSide = null;
            // Prefer anchoring to end when Backspace is pressed
            if (view.inputState.lastKeyCode === 8 && view.inputState.lastKeyTime > Date.now() - 100) {
                preferredPos = sel.to;
                preferredSide = "end";
            }
            var diff = findDiff(view.state.doc.slice(from, to, LINE_SEP), reader.text, preferredPos - from, preferredSide);
            if (diff)
                change = new Change(from + diff.from, from + diff.toA, reader.text.slice(diff.from, diff.toB).split(LINE_SEP));
        }
        else if (view.hasFocus()) {
            var domSel = view.root.getSelection();
            var head = view.docView.posFromDOM(domSel.focusNode, domSel.focusOffset);
            var anchor = selectionCollapsed(domSel) ? head :
                view.docView.posFromDOM(domSel.anchorNode, domSel.anchorOffset);
            if (head != sel.head || anchor != sel.anchor)
                newSel = EditorSelection.single(anchor, head);
        }
        if (!change && !newSel)
            return false;
        // Heuristic to notice typing over a selected character
        if (!change && typeOver && !sel.empty && newSel && newSel.primary.empty)
            change = new Change(sel.from, sel.to, view.state.doc.sliceLines(sel.from, sel.to));
        if (change) {
            var startState = view.state;
            // Android browsers don't fire reasonable key events for enter,
            // backspace, or delete. So this detects changes that look like
            // they're caused by those keys, and reinterprets them as key
            // events.
            if (browser.android &&
                ((change.from == sel.from && change.to == sel.to &&
                    change.length == 1 && change.text.length == 2 &&
                    dispatchKey(view, "Enter", 10)) ||
                    (change.from == sel.from - 1 && change.to == sel.to && change.length == 0 &&
                        dispatchKey(view, "Backspace", 8)) ||
                    (change.from == sel.from && change.to == sel.to + 1 && change.length == 0 &&
                        dispatchKey(view, "Delete", 46))))
                return view.state != startState;
            var tr = startState.transaction;
            if (change.from >= sel.from && change.to <= sel.to && change.to - change.from >= (sel.to - sel.from) / 3) {
                var before_1 = sel.from < change.from ? startState.doc.slice(sel.from, change.from, LINE_SEP) : "";
                var after_1 = sel.to > change.to ? startState.doc.slice(change.to, sel.to, LINE_SEP) : "";
                tr = tr.replaceSelection((before_1 + change.text.join(LINE_SEP) + after_1).split(LINE_SEP));
            }
            else {
                tr = tr.change(change);
                if (newSel && !tr.selection.primary.eq(newSel.primary))
                    tr = tr.setSelection(tr.selection.replaceRange(newSel.primary));
            }
            view.dispatch(tr.scrollIntoView());
            return true;
        }
        else if (newSel && !newSel.primary.eq(sel)) {
            var tr = view.state.transaction.setSelection(newSel);
            if (view.inputState.lastSelectionTime > Date.now() - 50) {
                if (view.inputState.lastSelectionOrigin == "keyboard")
                    tr = tr.scrollIntoView();
                else
                    tr = tr.addMeta(Transaction.userEvent(view.inputState.lastSelectionOrigin));
            }
            view.dispatch(tr);
            return true;
        }
        return false;
    }
    function findDiff(a, b, preferredPos, preferredSide) {
        var minLen = Math.min(a.length, b.length);
        var from = 0;
        while (from < minLen && a.charCodeAt(from) == b.charCodeAt(from))
            from++;
        if (from == minLen && a.length == b.length)
            return null;
        var toA = a.length, toB = b.length;
        while (toA > 0 && toB > 0 && a.charCodeAt(toA - 1) == b.charCodeAt(toB - 1)) {
            toA--;
            toB--;
        }
        if (preferredSide == "end") {
            var adjust = Math.max(0, from - Math.min(toA, toB));
            preferredPos -= toA + adjust - from;
        }
        if (toA < from && a.length < b.length) {
            var move = preferredPos <= from && preferredPos >= toA ? from - preferredPos : 0;
            from -= move;
            toB = from + (toB - toA);
            toA = from;
        }
        else if (toB < from) {
            var move = preferredPos <= from && preferredPos >= toB ? from - preferredPos : 0;
            from -= move;
            toA = from + (toA - toB);
            toB = from;
        }
        return { from: from, toA: toA, toB: toB };
    }
    var DOMReader = /** @class */ (function () {
        function DOMReader(points) {
            this.points = points;
            this.text = "";
        }
        DOMReader.prototype.readRange = function (start, end) {
            if (!start)
                return;
            var parent = start.parentNode;
            for (var cur = start;;) {
                this.findPointBefore(parent, cur);
                this.readNode(cur);
                var next = cur.nextSibling;
                if (next == end)
                    break;
                if (isBlockNode(cur) || (isBlockNode(next) && cur.nodeName != "BR"))
                    this.text += LINE_SEP;
                cur = next;
            }
            this.findPointBefore(parent, end);
        };
        DOMReader.prototype.readNode = function (node) {
            if (node.cmIgnore)
                return;
            var view = node.cmView;
            var fromView = view && view.overrideDOMText;
            var text;
            if (fromView != null)
                text = fromView.join(LINE_SEP);
            else if (node.nodeType == 3)
                text = node.nodeValue;
            else if (node.nodeName == "BR")
                text = node.nextSibling ? LINE_SEP : "";
            else if (node.nodeType == 1)
                this.readRange(node.firstChild, null);
            if (text != null) {
                this.findPointIn(node, text.length);
                this.text += text;
            }
        };
        DOMReader.prototype.findPointBefore = function (node, next) {
            for (var _i = 0, _a = this.points; _i < _a.length; _i++) {
                var point = _a[_i];
                if (point.node == node && node.childNodes[point.offset] == next)
                    point.pos = this.text.length;
            }
        };
        DOMReader.prototype.findPointIn = function (node, maxLen) {
            for (var _i = 0, _a = this.points; _i < _a.length; _i++) {
                var point = _a[_i];
                if (point.node == node)
                    point.pos = this.text.length + Math.min(point.offset, maxLen);
            }
        };
        return DOMReader;
    }());
    function isBlockNode(node) {
        return node.nodeType == 1 && /^(DIV|P|LI|UL|OL|BLOCKQUOTE|DD|DT|H\d|SECTION|PRE)$/.test(node.nodeName);
    }
    var DOMPoint = /** @class */ (function () {
        function DOMPoint(node, offset) {
            this.node = node;
            this.offset = offset;
            this.pos = -1;
        }
        return DOMPoint;
    }());
    function selectionPoints(dom, root) {
        var result = [];
        if (root.activeElement != dom)
            return result;
        var _a = root.getSelection(), anchorNode = _a.anchorNode, anchorOffset = _a.anchorOffset, focusNode = _a.focusNode, focusOffset = _a.focusOffset;
        if (anchorNode) {
            result.push(new DOMPoint(anchorNode, anchorOffset));
            if (focusNode != anchorNode || focusOffset != anchorOffset)
                result.push(new DOMPoint(focusNode, focusOffset));
        }
        return result;
    }
    function selectionFromPoints(points, base) {
        if (points.length == 0)
            return null;
        var anchor = points[0].pos, head = points.length == 2 ? points[1].pos : anchor;
        return anchor > -1 && head > -1 ? EditorSelection.single(anchor + base, head + base) : null;
    }
    function dispatchKey(view, name, code) {
        var options = { key: name, code: name, keyCode: code, which: code, cancelable: true };
        var down = new KeyboardEvent("keydown", options);
        view.contentDOM.dispatchEvent(down);
        var up = new KeyboardEvent("keyup", options);
        view.contentDOM.dispatchEvent(up);
        return down.defaultPrevented || up.defaultPrevented;
    }

    var EditorView = /** @class */ (function () {
        function EditorView(config) {
            var _this = this;
            this.plugins = [];
            // @internal
            this.updating = false;
            this.contentDOM = document.createElement("div");
            var tabSizeStyle = this.contentDOM.style.tabSize != null ? "tab-size: " : "-moz-tab-size: ";
            this.contentAttrs = new AttrsFor(ViewField.contentAttributeEffect, this.contentDOM, function () { return ({
                spellcheck: "false",
                contenteditable: "true",
                class: "codemirror-content " + styles.content,
                style: tabSizeStyle + _this.state.tabSize
            }); });
            this.dom = document.createElement("div");
            this.dom.appendChild(this.contentDOM);
            this.editorAttrs = new AttrsFor(ViewField.editorAttributeEffect, this.dom, function (view) { return ({
                class: "codemirror " + styles.wrapper + (view.hasFocus() ? " codemirror-focused" : "")
            }); });
            this.dispatch = config.dispatch || (function (tr) { return _this.updateState([tr], tr.apply()); });
            this.root = (config.root || document);
            this.docView = new DocView(this, function (start, end, typeOver) { return applyDOMChange(_this, start, end, typeOver); });
            this.setState(config.state, config.extensions);
        }
        EditorView.prototype.setState = function (state, extensions) {
            var _this = this;
            if (extensions === void 0) { extensions = []; }
            for (var _i = 0, _a = this.plugins; _i < _a.length; _i++) {
                var plugin = _a[_i];
                if (plugin.destroy)
                    plugin.destroy();
            }
            this.withUpdating(function () {
                _this.behavior = ViewExtension.resolve(extensions.concat(state.behavior.foreign));
                _this.fields = _this.behavior.get(viewField);
                styleMod_1.mount(_this.root, styles);
                for (var _i = 0, _a = _this.behavior.get(styleModule); _i < _a.length; _i++) {
                    var s = _a[_i];
                    styleMod_1.mount(_this.root, s);
                }
                if (_this.behavior.foreign.length)
                    throw new Error("Non-ViewExtension extensions found when setting view state");
                _this.inputState = new InputState(_this);
                _this.docView.init(state);
                _this.plugins = _this.behavior.get(viewPlugin).map(function (spec) { return spec(_this); });
                _this.contentAttrs.update(_this);
                _this.editorAttrs.update(_this);
            });
        };
        // FIXME rename this to update at some point, make state implicit in transactions
        EditorView.prototype.updateState = function (transactions, state, metadata) {
            var _this = this;
            if (metadata === void 0) { metadata = []; }
            if (transactions.length && transactions[0].startState != this.state)
                throw new RangeError("Trying to update state with a transaction that doesn't start from the current state.");
            this.withUpdating(function () {
                var snapshot = new ViewSnapshot(_this);
                if (state.doc != _this.state.doc || transactions.some(function (tr) { return tr.selectionSet && !tr.getMeta(Transaction.preserveGoalColumn); }))
                    _this.inputState.goalColumns.length = 0;
                _this.docView.update(transactions, state, metadata, transactions.some(function (tr) { return tr.scrolledIntoView; }) ? state.selection.primary.head : -1);
                _this.inputState.update(transactions);
                _this.updatePlugins(new ViewUpdate(snapshot, transactions, _this, metadata));
                _this.contentAttrs.update(_this);
                _this.editorAttrs.update(_this);
            });
        };
        // @internal
        EditorView.prototype.updatePlugins = function (update) {
            for (var _i = 0, _a = this.plugins; _i < _a.length; _i++) {
                var plugin = _a[_i];
                if (plugin.update)
                    plugin.update(update);
            }
        };
        // @internal
        EditorView.prototype.updateStateInner = function (state, viewport, transactions, metadata) {
            if (this.fieldValues) {
                var snapshot = new ViewSnapshot(this);
                this.viewport = viewport;
                this.state = state;
                this.fieldValues = [];
                var update = new ViewUpdate(snapshot, transactions, this, metadata);
                for (var i = 0; i < this.fields.length; i++)
                    this.fieldValues.push(this.fields[i].update(snapshot.fieldValues[i], update));
            }
            else {
                this.viewport = viewport;
                this.state = state;
                this.fieldValues = [];
                for (var _i = 0, _a = this.fields; _i < _a.length; _i++) {
                    var field = _a[_i];
                    this.fieldValues.push(field.create(this));
                }
            }
        };
        // @internal
        EditorView.prototype.withUpdating = function (f) {
            if (this.updating)
                throw new Error("Calls to EditorView.updateState or EditorView.setState are not allowed in extension update or create methods");
            this.updating = true;
            try {
                f();
            }
            finally {
                this.updating = false;
            }
        };
        EditorView.prototype.getField = function (field, defaultValue) {
            return getField(field, this.fields, this.fieldValues, defaultValue);
        };
        EditorView.prototype.getEffect = function (type) {
            var result = [];
            for (var i = 0; i < this.fieldValues.length; i++) {
                var accessor = Slot.get(type, this.fields[i].effects);
                if (accessor)
                    result.push(accessor(this.fieldValues[i]));
            }
            return result;
        };
        EditorView.prototype.domAtPos = function (pos) {
            return this.docView.domFromPos(pos);
        };
        EditorView.prototype.heightAtPos = function (pos, top) {
            this.docView.forceLayout();
            return this.docView.heightAt(pos, top ? -1 : 1);
        };
        EditorView.prototype.lineAtHeight = function (height) {
            this.docView.forceLayout();
            return this.docView.lineAtHeight(height);
        };
        Object.defineProperty(EditorView.prototype, "contentHeight", {
            get: function () {
                return this.docView.heightMap.height + this.docView.paddingTop + this.docView.paddingBottom;
            },
            enumerable: true,
            configurable: true
        });
        EditorView.prototype.movePos = function (start, direction, granularity, action) {
            if (granularity === void 0) { granularity = "character"; }
            if (action === void 0) { action = "move"; }
            return movePos(this, start, direction, granularity, action);
        };
        EditorView.prototype.posAtCoords = function (coords) {
            this.docView.forceLayout();
            return posAtCoords(this, coords);
        };
        EditorView.prototype.coordsAtPos = function (pos) { return this.docView.coordsAt(pos); };
        Object.defineProperty(EditorView.prototype, "defaultCharacterWidth", {
            get: function () { return this.docView.heightOracle.charWidth; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(EditorView.prototype, "defaultLineHeight", {
            get: function () { return this.docView.heightOracle.lineHeight; },
            enumerable: true,
            configurable: true
        });
        EditorView.prototype.viewportLines = function (f) {
            var _a = this.viewport, from = _a.from, to = _a.to;
            this.docView.heightMap.forEachLine(from, to, 0, this.docView.heightOracle, f);
        };
        EditorView.prototype.startMouseSelection = function (event, update) {
            this.focus();
            this.inputState.startMouseSelection(this, event, update);
        };
        EditorView.prototype.hasFocus = function () {
            return this.root.activeElement == this.contentDOM;
        };
        EditorView.prototype.focus = function () {
            this.docView.focus();
        };
        EditorView.prototype.destroy = function () {
            for (var _i = 0, _a = this.plugins; _i < _a.length; _i++) {
                var plugin = _a[_i];
                if (plugin.destroy)
                    plugin.destroy();
            }
            this.inputState.destroy();
            this.dom.remove();
            this.docView.destroy();
        };
        return EditorView;
    }());
    var AttrsFor = /** @class */ (function () {
        function AttrsFor(effect, dom, deflt) {
            this.effect = effect;
            this.dom = dom;
            this.deflt = deflt;
            this.attrs = null;
        }
        AttrsFor.prototype.update = function (view) {
            var attrs = this.deflt(view);
            for (var _i = 0, _a = view.getEffect(this.effect); _i < _a.length; _i++) {
                var spec = _a[_i];
                if (spec)
                    attrs = combineAttrs(spec, attrs);
            }
            updateAttrs(this.dom, this.attrs, attrs);
            this.attrs = attrs;
        };
        return AttrsFor;
    }());
    var styles = new styleMod_1({
        wrapper: {
            position: "relative !important",
            display: "flex !important",
            alignItems: "flex-start !important",
            fontFamily: "monospace",
            lineHeight: 1.4,
            "&.codemirror-focused": {
                // FIXME it would be great if we could directly use the browser's
                // default focus outline, but it appears we can't, so this tries to
                // approximate that
                outline_fallback: "1px dotted #212121",
                outline: "5px auto -webkit-focus-ring-color"
            }
        },
        content: {
            margin: 0,
            flexGrow: 2,
            minHeight: "100%",
            display: "block",
            whiteSpace: "pre",
            boxSizing: "border-box",
            padding: "4px 2px 4px 4px",
            outline: "none",
            caretColor: "black",
            "& codemirror-line": {
                display: "block"
            }
        }
    }, { priority: 0 });

    var base = {
      8: "Backspace",
      9: "Tab",
      10: "Enter",
      12: "NumLock",
      13: "Enter",
      16: "Shift",
      17: "Control",
      18: "Alt",
      20: "CapsLock",
      27: "Escape",
      32: " ",
      33: "PageUp",
      34: "PageDown",
      35: "End",
      36: "Home",
      37: "ArrowLeft",
      38: "ArrowUp",
      39: "ArrowRight",
      40: "ArrowDown",
      44: "PrintScreen",
      45: "Insert",
      46: "Delete",
      59: ";",
      61: "=",
      91: "Meta",
      92: "Meta",
      106: "*",
      107: "+",
      108: ",",
      109: "-",
      110: ".",
      111: "/",
      144: "NumLock",
      145: "ScrollLock",
      160: "Shift",
      161: "Shift",
      162: "Control",
      163: "Control",
      164: "Alt",
      165: "Alt",
      173: "-",
      186: ";",
      187: "=",
      188: ",",
      189: "-",
      190: ".",
      191: "/",
      192: "`",
      219: "[",
      220: "\\",
      221: "]",
      222: "'",
      229: "q"
    };
    var base_1 = base;

    var shift = {
      48: ")",
      49: "!",
      50: "@",
      51: "#",
      52: "$",
      53: "%",
      54: "^",
      55: "&",
      56: "*",
      57: "(",
      59: ";",
      61: "+",
      173: "_",
      186: ":",
      187: "+",
      188: "<",
      189: "_",
      190: ">",
      191: "?",
      192: "~",
      219: "{",
      220: "|",
      221: "}",
      222: "\"",
      229: "Q"
    };

    var chrome$1 = typeof navigator != "undefined" && /Chrome\/(\d+)/.exec(navigator.userAgent);
    var safari = typeof navigator != "undefined" && /Apple Computer/.test(navigator.vendor);
    var gecko$1 = typeof navigator != "undefined" && /Gecko\/\d+/.test(navigator.userAgent);
    var mac = typeof navigator != "undefined" && /Mac/.test(navigator.platform);
    var brokenModifierNames = chrome$1 && (mac || +chrome$1[1] < 57) || gecko$1 && mac;

    // Fill in the digit keys
    for (var i = 0; i < 10; i++) base[48 + i] = base[96 + i] = String(i);

    // The function keys
    for (var i = 1; i <= 24; i++) base[i + 111] = "F" + i;

    // And the alphabetic keys
    for (var i = 65; i <= 90; i++) {
      base[i] = String.fromCharCode(i + 32);
      shift[i] = String.fromCharCode(i);
    }

    // For each code that doesn't have a shift-equivalent, copy the base name
    for (var code in base) if (!shift.hasOwnProperty(code)) shift[code] = base[code];

    var keyName = function(event) {
      // Don't trust event.key in Chrome when there are modifiers until
      // they fix https://bugs.chromium.org/p/chromium/issues/detail?id=633838
      var ignoreKey = brokenModifierNames && (event.ctrlKey || event.altKey || event.metaKey) ||
        safari && event.shiftKey && event.key && event.key.length == 1;
      var name = (!ignoreKey && event.key) ||
        (event.shiftKey ? shift : base)[event.keyCode] ||
        event.key || "Unidentified";
      // Edge sometimes produces wrong names (Issue #3)
      if (name == "Esc") name = "Escape";
      if (name == "Del") name = "Delete";
      // https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/8860571/
      if (name == "Left") name = "ArrowLeft";
      if (name == "Up") name = "ArrowUp";
      if (name == "Right") name = "ArrowRight";
      if (name == "Down") name = "ArrowDown";
      return name
    };

    var mac$1 = typeof navigator != "undefined" ? /Mac/.test(navigator.platform) : false;
    function normalizeKeyName(name) {
        var parts = name.split(/-(?!$)/);
        var result = parts[parts.length - 1];
        if (result == "Space")
            result = " ";
        var alt, ctrl, shift, meta;
        for (var i = 0; i < parts.length - 1; ++i) {
            var mod = parts[i];
            if (/^(cmd|meta|m)$/i.test(mod))
                meta = true;
            else if (/^a(lt)?$/i.test(mod))
                alt = true;
            else if (/^(c|ctrl|control)$/i.test(mod))
                ctrl = true;
            else if (/^s(hift)?$/i.test(mod))
                shift = true;
            else if (/^mod$/i.test(mod)) {
                if (mac$1)
                    meta = true;
                else
                    ctrl = true;
            }
            else
                throw new Error("Unrecognized modifier name: " + mod);
        }
        if (alt)
            result = "Alt-" + result;
        if (ctrl)
            result = "Ctrl-" + result;
        if (meta)
            result = "Meta-" + result;
        if (shift)
            result = "Shift-" + result;
        return result;
    }
    function normalize(map) {
        var copy = Object.create(null);
        for (var prop in map)
            copy[normalizeKeyName(prop)] = map[prop];
        return copy;
    }
    function modifiers(name, event, shift) {
        if (event.altKey)
            name = "Alt-" + name;
        if (event.ctrlKey)
            name = "Ctrl-" + name;
        if (event.metaKey)
            name = "Meta-" + name;
        if (shift !== false && event.shiftKey)
            name = "Shift-" + name;
        return name;
    }
    // Behavior for defining keymaps
    //
    // Specs are objects that map key names to command-style functions,
    // which will be called with an editor view and should return true
    // when they've handled the key.
    //
    // Key names may be strings like `"Shift-Ctrl-Enter"`—a key identifier
    // prefixed with zero or more modifiers. Key identifiers are based on
    // the strings that can appear in
    // [`KeyEvent.key`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key).
    // Use lowercase letters to refer to letter keys (or uppercase letters
    // if you want shift to be held). You may use `"Space"` as an alias
    // for the `" "` name.
    //
    // Modifiers can be given in any order. `Shift-` (or `s-`), `Alt-` (or
    // `a-`), `Ctrl-` (or `c-` or `Control-`) and `Cmd-` (or `m-` or
    // `Meta-`) are recognized.
    //
    // You can use `Mod-` as a shorthand for `Cmd-` on Mac and `Ctrl-` on
    // other platforms.
    //
    // You can add multiple keymap behaviors to an editor. Their
    // priorities determine their precedence (the ones specified early or
    // with high priority get to dispatch first).
    var keymap = function (map) { return handleDOMEvents({
        keydown: keydownHandler(normalize(map))
    }); };
    function keydownHandler(map) {
        return function (view, event) {
            var name = keyName(event), isChar = name.length == 1 && name != " ";
            var direct = map[modifiers(name, event, !isChar)];
            var baseName;
            if (direct && direct(view))
                return true;
            if (isChar && (event.shiftKey || event.altKey || event.metaKey) &&
                (baseName = base_1[event.keyCode]) && baseName != name) {
                var fromCode = map[modifiers(baseName, event, true)];
                if (fromCode && fromCode(view))
                    return true;
            }
            return false;
        };
    }

    var Item = /** @class */ (function () {
        function Item(map, inverted, selection) {
            if (inverted === void 0) { inverted = null; }
            if (selection === void 0) { selection = null; }
            this.map = map;
            this.inverted = inverted;
            this.selection = selection;
        }
        Object.defineProperty(Item.prototype, "isChange", {
            get: function () { return this.inverted != null; },
            enumerable: true,
            configurable: true
        });
        return Item;
    }());
    function updateBranch(branch, to, maxLen, newItem) {
        var start = to + 1 > maxLen + 20 ? to - maxLen - 1 : 0;
        var newBranch = branch.slice(start, to);
        newBranch.push(newItem);
        return newBranch;
    }
    function isAdjacent(prev, cur) {
        return !!prev && cur.from <= prev.mapPos(prev.to, 1) && cur.to >= prev.mapPos(prev.from);
    }
    function addChanges(branch, changes, inverted, selectionBefore, maxLen, mayMerge) {
        if (branch.length) {
            var lastItem = branch[branch.length - 1];
            if (lastItem.selection && lastItem.isChange == Boolean(inverted) && mayMerge(lastItem))
                return inverted ? updateBranch(branch, branch.length - 1, maxLen, new Item(lastItem.map.appendSet(changes.desc), inverted.appendSet(lastItem.inverted), lastItem.selection)) : branch;
        }
        return updateBranch(branch, branch.length, maxLen, new Item(changes.desc, inverted, selectionBefore));
    }
    function popChanges(branch, only) {
        var map = null;
        var idx = branch.length - 1;
        for (;; idx--) {
            if (idx < 0)
                throw new RangeError("popChanges called on empty branch");
            var entry = branch[idx];
            if (entry.isChange || (only == 1 /* Any */ && entry.selection))
                break;
            map = map ? entry.map.appendSet(map) : entry.map;
        }
        var changeItem = branch[idx];
        var newBranch = branch.slice(0, idx), changes = changeItem.inverted || ChangeSet.empty, selection = changeItem.selection;
        if (map) {
            var startIndex = changeItem.map.length;
            map = changeItem.map.appendSet(map);
            var mappedChanges = [];
            for (var i = 0; i < changes.length; i++) {
                var mapped = changes.changes[i].map(map.partialMapping(startIndex - i));
                if (mapped) {
                    map = map.append(mapped.desc);
                    mappedChanges.push(mapped);
                }
            }
            newBranch.push(new Item(map));
            changes = new ChangeSet(mappedChanges); // FIXME preserve mirror data?
            selection = selection.map(map);
        }
        return { changes: changes, branch: newBranch, selection: selection };
    }
    function nope() { return false; }
    function eqSelectionShape(a, b) {
        return a.ranges.length == b.ranges.length &&
            a.ranges.filter(function (r, i) { return r.empty != b.ranges[i].empty; }).length === 0;
    }
    var HistoryState = /** @class */ (function () {
        function HistoryState(done, undone, prevTime, prevUserEvent) {
            if (prevTime === void 0) { prevTime = null; }
            if (prevUserEvent === void 0) { prevUserEvent = undefined; }
            this.done = done;
            this.undone = undone;
            this.prevTime = prevTime;
            this.prevUserEvent = prevUserEvent;
        }
        HistoryState.prototype.resetTime = function () {
            return new HistoryState(this.done, this.undone);
        };
        HistoryState.prototype.addChanges = function (changes, inverted, selection, time, userEvent, newGroupDelay, maxLen) {
            var mayMerge = nope;
            if (this.prevTime !== null && time - this.prevTime < newGroupDelay &&
                (inverted || (this.prevUserEvent == userEvent && userEvent == "keyboard")))
                mayMerge = inverted
                    ? function (prev) { return isAdjacent(prev.map.changes[prev.map.length - 1], changes.changes[0]); }
                    : function (prev) { return eqSelectionShape(prev.selection, selection); };
            return new HistoryState(addChanges(this.done, changes, inverted, selection, maxLen, mayMerge), this.undone, time, userEvent);
        };
        HistoryState.prototype.addMapping = function (map, maxLen) {
            if (this.done.length == 0)
                return this;
            return new HistoryState(updateBranch(this.done, this.done.length, maxLen, new Item(map)), this.undone);
        };
        HistoryState.prototype.canPop = function (done, only) {
            var target = done == 0 /* Done */ ? this.done : this.undone;
            for (var _i = 0, target_1 = target; _i < target_1.length; _i++) {
                var _a = target_1[_i], isChange = _a.isChange, selection = _a.selection;
                if (isChange || (only == 1 /* Any */ && selection))
                    return true;
            }
            return false;
        };
        HistoryState.prototype.pop = function (done, only, transaction, maxLen) {
            var _a = popChanges(done == 0 /* Done */ ? this.done : this.undone, only), changes = _a.changes, branch = _a.branch, selection = _a.selection;
            var oldSelection = transaction.selection;
            for (var _i = 0, _b = changes.changes; _i < _b.length; _i++) {
                var change = _b[_i];
                transaction = transaction.change(change);
            }
            transaction = transaction.setSelection(selection);
            var otherBranch = (done == 0 /* Done */ ? this.undone : this.done);
            otherBranch = addChanges(otherBranch, transaction.changes, transaction.changes.length > 0 ? transaction.invertedChanges() : null, oldSelection, maxLen, nope);
            return { transaction: transaction, state: new HistoryState(done == 0 /* Done */ ? branch : otherBranch, done == 0 /* Done */ ? otherBranch : branch) };
        };
        HistoryState.prototype.eventCount = function (done, only) {
            var count = 0, branch = done == 0 /* Done */ ? this.done : this.undone;
            for (var _i = 0, branch_1 = branch; _i < branch_1.length; _i++) {
                var _a = branch_1[_i], isChange = _a.isChange, selection = _a.selection;
                if (isChange || (only == 1 /* Any */ && selection))
                    ++count;
            }
            return count;
        };
        HistoryState.empty = new HistoryState([], []);
        return HistoryState;
    }());

    var historyStateSlot = Slot.define();
    var closeHistorySlot = Slot.define();
    function historyField(_a) {
        var minDepth = _a.minDepth, newGroupDelay = _a.newGroupDelay;
        return new StateField({
            init: function (editorState) {
                return HistoryState.empty;
            },
            apply: function (tr, state, editorState) {
                var fromMeta = tr.getMeta(historyStateSlot);
                if (fromMeta)
                    return fromMeta;
                if (tr.getMeta(closeHistorySlot))
                    state = state.resetTime();
                if (!tr.changes.length && !tr.selectionSet)
                    return state;
                if (tr.getMeta(Transaction.addToHistory) !== false)
                    return state.addChanges(tr.changes, tr.changes.length ? tr.invertedChanges() : null, tr.startState.selection, tr.getMeta(Transaction.time), tr.getMeta(Transaction.userEvent), newGroupDelay, minDepth);
                return state.addMapping(tr.changes.desc, minDepth);
            }
        });
    }
    var HistoryContext = /** @class */ (function () {
        function HistoryContext(field, config) {
            this.field = field;
            this.config = config;
        }
        return HistoryContext;
    }());
    var historyBehavior = StateExtension.defineBehavior();
    var history = StateExtension.unique(function (configs) {
        var config = combineConfig(configs, {
            minDepth: 100,
            newGroupDelay: 500
        }, { minDepth: Math.max });
        var field = historyField(config);
        return StateExtension.all(field.extension, historyBehavior(new HistoryContext(field, config)));
    }, {});
    function cmd(target, only) {
        return function (_a) {
            var state = _a.state, dispatch = _a.dispatch;
            var hist = state.behavior.get(historyBehavior);
            if (!hist.length)
                return false;
            var _b = hist[0], field = _b.field, config = _b.config;
            var historyState = state.getField(field);
            if (!historyState.canPop(target, only))
                return false;
            var _c = historyState.pop(target, only, state.transaction, config.minDepth), transaction = _c.transaction, newState = _c.state;
            dispatch(transaction.addMeta(historyStateSlot(newState)));
            return true;
        };
    }
    var undo = cmd(0 /* Done */, 0 /* OnlyChanges */);
    var redo = cmd(1 /* Undone */, 0 /* OnlyChanges */);
    var undoSelection = cmd(0 /* Done */, 1 /* Any */);
    var redoSelection = cmd(1 /* Undone */, 1 /* Any */);

    var gutter = ViewExtension.unique(function (configs) {
        var config = combineConfig(configs, {
            fixed: true,
            formatNumber: String
        });
        return ViewExtension.all(viewPlugin(function (view) { return new GutterView(view, config); }), styleModule(styles$1));
    }, {});
    var GutterView = /** @class */ (function () {
        function GutterView(view, config) {
            this.view = view;
            this.spaceAbove = 0;
            this.lines = [];
            this.dom = document.createElement("div");
            this.dom.className = "codemirror-gutter " + styles$1.gutter;
            this.dom.setAttribute("aria-hidden", "true");
            this.dom.style.cssText = "left: 0; box-sizing: border-box; height: 100%; overflow: hidden; flex-shrink: 0;";
            if (config.fixed) {
                // FIXME IE11 fallback, which doesn't support position: sticky,
                // by using position: relative + event handlers that realign the
                // gutter (or just force fixed=false on IE11?)
                this.dom.style.position = "sticky";
            }
            view.dom.insertBefore(this.dom, view.contentDOM);
            this.formatNumber = config.formatNumber;
            this.lastLine = new GutterLine(1, 0, 0, 0, this.formatNumber);
            this.lastLine.dom.style.cssText += "visibility: hidden; pointer-events: none";
            this.dom.appendChild(this.lastLine.dom);
            this.update();
        }
        GutterView.prototype.update = function () {
            // Create the first number consisting of all 9s that is at least
            // as big as the line count, and put that in this.lastLine to make
            // sure the gutter width is stable
            var last = 9;
            while (last < this.view.state.doc.lines)
                last = last * 10 + 9;
            this.lastLine.update(last, 0, 0, 0, this.formatNumber);
            // FIXME would be nice to be able to recognize updates that didn't redraw
            this.updateGutter();
        };
        GutterView.prototype.updateGutter = function () {
            var _this = this;
            var spaceAbove = this.view.heightAtPos(this.view.viewport.from, true);
            if (spaceAbove != this.spaceAbove) {
                this.spaceAbove = spaceAbove;
                this.dom.style.paddingTop = spaceAbove + "px";
            }
            var i = 0, lineNo = -1;
            this.view.viewportLines(function (line) {
                var above = line.textTop, below = line.height - line.textBottom, height = line.height - above - below;
                if (lineNo < 0)
                    lineNo = _this.view.state.doc.lineAt(line.start).number;
                if (i == _this.lines.length) {
                    var newLine = new GutterLine(lineNo, height, above, below, _this.formatNumber);
                    _this.lines.push(newLine);
                    _this.dom.appendChild(newLine.dom);
                }
                else {
                    _this.lines[i].update(lineNo, height, above, below, _this.formatNumber);
                }
                lineNo = line.hasCollapsedRanges ? -1 : lineNo + 1;
                i++;
            });
            while (this.lines.length > i)
                this.dom.removeChild(this.lines.pop().dom);
            this.dom.style.minHeight = this.view.contentHeight + "px";
        };
        GutterView.prototype.destroy = function () {
            this.dom.remove();
        };
        Object.defineProperty(GutterView.prototype, "styles", {
            get: function () { return styles$1; },
            enumerable: true,
            configurable: true
        });
        return GutterView;
    }());
    var GutterLine = /** @class */ (function () {
        function GutterLine(lineNo, height, above, below, formatNo) {
            this.lineNo = -1;
            this.height = -1;
            this.above = 0;
            this.below = 0;
            this.dom = document.createElement("div");
            this.dom.className = "codemirror-gutter-element";
            this.update(lineNo, height, above, below, formatNo);
        }
        GutterLine.prototype.update = function (lineNo, height, above, below, formatNo) {
            if (this.lineNo != lineNo)
                this.dom.textContent = formatNo(this.lineNo = lineNo);
            if (this.height != height)
                this.dom.style.height = (this.height = height) + "px";
            if (this.above != above)
                this.dom.style.marginTop = (this.above = above) ? above + "px" : "";
            if (this.below != below)
                this.dom.style.marginBottom = (this.below = below) ? below + "px" : "";
        };
        return GutterLine;
    }());
    var styles$1 = new styleMod_1({
        gutter: {
            background: "#f5f5f5",
            borderRight: "1px solid silver",
            display: "flex !important",
            flexDirection: "column",
            "& > .codemirror-gutter-element": {
                boxSizing: "border-box",
                // FIXME these are line number specific
                padding: "0 3px 0 5px",
                minWidth: "20px",
                textAlign: "right",
                color: "#999",
                whiteSpace: "nowrap"
            }
        }
    });

    function moveSelection(view, dir, granularity) {
        var transaction = view.state.transaction.mapRanges(function (range) {
            if (!range.empty && granularity != "lineboundary")
                return new SelectionRange(dir == "left" || dir == "backward" ? range.from : range.to);
            return new SelectionRange(view.movePos(range.head, dir, granularity, "move"));
        });
        if (transaction.selection.eq(view.state.selection))
            return false;
        if (granularity == "line")
            transaction = transaction.addMeta(Transaction.preserveGoalColumn(true));
        view.dispatch(transaction.scrollIntoView());
        return true;
    }
    var moveCharLeft = function (view) { return moveSelection(view, "left", "character"); };
    var moveCharRight = function (view) { return moveSelection(view, "right", "character"); };
    var moveWordLeft = function (view) { return moveSelection(view, "left", "word"); };
    var moveWordRight = function (view) { return moveSelection(view, "right", "word"); };
    var moveLineUp = function (view) { return moveSelection(view, "backward", "line"); };
    var moveLineDown = function (view) { return moveSelection(view, "forward", "line"); };
    var moveLineStart = function (view) { return moveSelection(view, "backward", "lineboundary"); };
    var moveLineEnd = function (view) { return moveSelection(view, "forward", "lineboundary"); };
    function extendSelection(view, dir, granularity) {
        var transaction = view.state.transaction.mapRanges(function (range) {
            return new SelectionRange(range.anchor, view.movePos(range.head, dir, granularity, "extend"));
        });
        if (transaction.selection.eq(view.state.selection))
            return false;
        if (granularity == "line")
            transaction = transaction.addMeta(Transaction.preserveGoalColumn(true));
        view.dispatch(transaction.scrollIntoView());
        return true;
    }
    var extendCharLeft = function (view) { return extendSelection(view, "left", "character"); };
    var extendCharRight = function (view) { return extendSelection(view, "right", "character"); };
    var extendWordLeft = function (view) { return extendSelection(view, "left", "word"); };
    var extendWordRight = function (view) { return extendSelection(view, "right", "word"); };
    var extendLineUp = function (view) { return extendSelection(view, "backward", "line"); };
    var extendLineDown = function (view) { return extendSelection(view, "forward", "line"); };
    var extendLineStart = function (view) { return extendSelection(view, "backward", "lineboundary"); };
    var extendLineEnd = function (view) { return extendSelection(view, "forward", "lineboundary"); };
    var selectDocStart = function (_a) {
        var state = _a.state, dispatch = _a.dispatch;
        dispatch(state.transaction.setSelection(EditorSelection.single(0)).scrollIntoView());
        return true;
    };
    var selectDocEnd = function (_a) {
        var state = _a.state, dispatch = _a.dispatch;
        dispatch(state.transaction.setSelection(EditorSelection.single(state.doc.length)).scrollIntoView());
        return true;
    };
    var selectAll = function (_a) {
        var state = _a.state, dispatch = _a.dispatch;
        dispatch(state.transaction.setSelection(EditorSelection.single(0, state.doc.length)));
        return true;
    };
    function deleteText(view, dir) {
        var transaction = view.state.transaction.reduceRanges(function (transaction, range) {
            var from = range.from, to = range.to;
            if (from == to) {
                var target = view.movePos(range.head, dir, "character", "move");
                from = Math.min(from, target);
                to = Math.max(to, target);
            }
            if (from == to)
                return { transaction: transaction, range: range };
            return { transaction: transaction.replace(from, to, ""),
                range: new SelectionRange(from) };
        });
        if (!transaction.docChanged)
            return false;
        view.dispatch(transaction.scrollIntoView());
        return true;
    }
    var deleteCharBackward = function (view) { return deleteText(view, "backward"); };
    var deleteCharForward = function (view) { return deleteText(view, "forward"); };
    // FIXME support indenting by tab, configurable indent units
    function space(n) {
        var result = "";
        for (var i = 0; i < n; i++)
            result += " ";
        return result;
    }
    function getIndentation(state, pos) {
        for (var _i = 0, _a = state.behavior.get(StateExtension.indentation); _i < _a.length; _i++) {
            var f = _a[_i];
            var result = f(state, pos);
            if (result > -1)
                return result;
        }
        return -1;
    }
    function insertNewlineAndIndent(_a) {
        var state = _a.state, dispatch = _a.dispatch;
        var indentation = state.selection.ranges.map(function (r) { return getIndentation(state, r.from); }), i = 0;
        dispatch(state.transaction.reduceRanges(function (tr, range) {
            var indent = indentation[i++];
            return { transaction: tr.replace(range.from, range.to, ["", space(indent)]),
                range: new SelectionRange(range.from + indent + 1) };
        }).scrollIntoView());
        return true;
    }
    function indentSelection(_a) {
        var state = _a.state, dispatch = _a.dispatch;
        var _b;
        var lastLine = -1, positions = [];
        for (var _i = 0, _c = state.selection.ranges; _i < _c.length; _i++) {
            var range = _c[_i];
            for (var _d = state.doc.lineAt(range.from), start = _d.start, end = _d.end;;) {
                if (start != lastLine) {
                    lastLine = start;
                    var indent = getIndentation(state, start), current = void 0;
                    if (indent > -1 &&
                        indent != (current = /^\s*/.exec(state.doc.slice(start, Math.min(end, start + 100)))[0].length))
                        positions.push({ pos: start, current: current, indent: indent });
                }
                if (end + 1 > range.to)
                    break;
                (_b = state.doc.lineAt(end + 1), start = _b.start, end = _b.end);
            }
        }
        if (positions.length > 0) {
            var tr = state.transaction;
            for (var _e = 0, positions_1 = positions; _e < positions_1.length; _e++) {
                var _f = positions_1[_e], pos = _f.pos, current = _f.current, indent = _f.indent;
                var start = tr.changes.mapPos(pos);
                tr = tr.replace(start, start + current, space(indent));
            }
            dispatch(tr);
        }
        return true;
    }
    var pcBaseKeymap = {
        "ArrowLeft": moveCharLeft,
        "ArrowRight": moveCharRight,
        "Shift-ArrowLeft": extendCharLeft,
        "Shift-ArrowRight": extendCharRight,
        "Mod-ArrowLeft": moveWordLeft,
        "Mod-ArrowRight": moveWordRight,
        "Shift-Mod-ArrowLeft": extendWordLeft,
        "Shift-Mod-ArrowRight": extendWordRight,
        "ArrowUp": moveLineUp,
        "ArrowDown": moveLineDown,
        "Shift-ArrowUp": extendLineUp,
        "Shift-ArrowDown": extendLineDown,
        "Home": moveLineStart,
        "End": moveLineEnd,
        "Shift-Home": extendLineStart,
        "Shift-End": extendLineEnd,
        "Mod-Home": selectDocStart,
        "Mod-End": selectDocEnd,
        "Mod-a": selectAll,
        "Backspace": deleteCharBackward,
        "Delete": deleteCharForward,
        "Enter": insertNewlineAndIndent
    };
    var macBaseKeymap = {
        "Control-b": moveCharLeft,
        "Control-f": moveCharRight,
        "Shift-Control-b": extendCharLeft,
        "Shift-Control-f": extendCharRight,
        "Control-p": moveLineUp,
        "Control-n": moveLineDown,
        "Shift-Control-p": extendLineUp,
        "Shift-Control-n": extendLineDown,
        "Control-a": moveLineStart,
        "Control-e": moveLineEnd,
        "Shift-Control-a": extendLineStart,
        "Shift-Control-e": extendLineEnd,
        "Cmd-ArrowUp": selectDocStart,
        "Cmd-ArrowDown": selectDocEnd,
        "Control-d": deleteCharForward,
        "Control-h": deleteCharBackward
    };
    for (var key in pcBaseKeymap)
        macBaseKeymap[key] = pcBaseKeymap[key];
    var mac$2 = typeof navigator != "undefined" ? /Mac/.test(navigator.platform)
        : typeof os != "undefined" ? os.platform() == "darwin" : false;
    var baseKeymap = mac$2 ? macBaseKeymap : pcBaseKeymap;

    // Counts the column offset in a string, taking tabs into account.
    // Used mostly to find indentation.
    function countColumn$1(string, end, tabSize, startIndex, startValue) {
        if (end == null) {
            end = string.search(/[^\s\u00a0]/);
            if (end == -1)
                end = string.length;
        }
        for (var i = startIndex || 0, n = startValue || 0;;) {
            var nextTab = string.indexOf("\t", i);
            if (nextTab < 0 || nextTab >= end)
                return n + (end - i);
            n += nextTab - i;
            n += tabSize - (n % tabSize);
            i = nextTab + 1;
        }
    }

    // STRING STREAM
    // Fed to the mode parsers, provides helper functions to make
    // parsers more succinct.
    var StringStream = /** @class */ (function () {
        function StringStream(string, tabSize, lineOracle) {
            this.string = string;
            this.tabSize = tabSize;
            this.lineOracle = lineOracle;
            this.pos = this.start = 0;
            this.string = string;
            this.tabSize = tabSize || 8;
            this.lastColumnPos = this.lastColumnValue = 0;
            this.lineStart = 0;
            this.lineOracle = lineOracle;
        }
        StringStream.prototype.eol = function () { return this.pos >= this.string.length; };
        StringStream.prototype.sol = function () { return this.pos == this.lineStart; };
        StringStream.prototype.peek = function () { return this.string.charAt(this.pos) || undefined; };
        StringStream.prototype.next = function () {
            if (this.pos < this.string.length)
                return this.string.charAt(this.pos++);
        };
        StringStream.prototype.eat = function (match) {
            var ch = this.string.charAt(this.pos);
            var ok;
            if (typeof match == "string")
                ok = ch == match;
            else
                ok = ch && (match instanceof RegExp ? match.test(ch) : match(ch));
            if (ok) {
                ++this.pos;
                return ch;
            }
        };
        StringStream.prototype.eatWhile = function (match) {
            var start = this.pos;
            while (this.eat(match)) { }
            return this.pos > start;
        };
        StringStream.prototype.eatSpace = function () {
            var start = this.pos;
            while (/[\s\u00a0]/.test(this.string.charAt(this.pos)))
                ++this.pos;
            return this.pos > start;
        };
        StringStream.prototype.skipToEnd = function () { this.pos = this.string.length; };
        StringStream.prototype.skipTo = function (ch) {
            var found = this.string.indexOf(ch, this.pos);
            if (found > -1) {
                this.pos = found;
                return true;
            }
        };
        StringStream.prototype.backUp = function (n) { this.pos -= n; };
        StringStream.prototype.column = function () {
            if (this.lastColumnPos < this.start) {
                this.lastColumnValue = countColumn$1(this.string, this.start, this.tabSize, this.lastColumnPos, this.lastColumnValue);
                this.lastColumnPos = this.start;
            }
            return this.lastColumnValue - (this.lineStart ? countColumn$1(this.string, this.lineStart, this.tabSize) : 0);
        };
        StringStream.prototype.indentation = function () {
            return countColumn$1(this.string, null, this.tabSize) -
                (this.lineStart ? countColumn$1(this.string, this.lineStart, this.tabSize) : 0);
        };
        StringStream.prototype.match = function (pattern, consume, caseInsensitive) {
            if (typeof pattern == "string") {
                var cased = function (str) { return caseInsensitive ? str.toLowerCase() : str; };
                var substr = this.string.substr(this.pos, pattern.length);
                if (cased(substr) == cased(pattern)) {
                    if (consume !== false)
                        this.pos += pattern.length;
                    return true;
                }
                else
                    return null;
            }
            else {
                var match = this.string.slice(this.pos).match(pattern);
                if (match && match.index > 0)
                    return null;
                if (match && consume !== false)
                    this.pos += match[0].length;
                return match;
            }
        };
        StringStream.prototype.current = function () { return this.string.slice(this.start, this.pos); };
        StringStream.prototype.hideFirstChars = function (n, inner) {
            this.lineStart += n;
            try {
                return inner();
            }
            finally {
                this.lineStart -= n;
            }
        };
        StringStream.prototype.lookAhead = function (n) {
            var oracle = this.lineOracle;
            return oracle && oracle.lookAhead(n);
        };
        StringStream.prototype.baseToken = function () {
            var oracle = this.lineOracle;
            return oracle && oracle.baseToken(this.pos);
        };
        return StringStream;
    }());

    var StringStreamCursor = /** @class */ (function () {
        function StringStreamCursor(text, offset, tabSize) {
            if (tabSize === void 0) { tabSize = 4; }
            this.offset = offset;
            this.tabSize = tabSize;
            this.iter = text.iterLines(offset);
            this.curLineEnd = this.offset - 1;
        }
        StringStreamCursor.prototype.next = function () {
            var _a = this.iter.next(), value = _a.value, done = _a.done;
            if (done)
                throw new RangeError("Reached end of document");
            var res = new StringStream(value, this.tabSize, null);
            this.offset = this.curLineEnd + 1;
            this.curLineEnd += value.length + 1;
            return res;
        };
        return StringStreamCursor;
    }());

    function readToken(mode, stream, state) {
        for (var i = 0; i < 10; i++) {
            //if (inner) inner[0] = innerMode(mode, state).mode
            var style = mode.token(stream, state);
            if (stream.pos > stream.start)
                return style;
        }
        throw new Error("Mode " + mode.name + " failed to advance stream.");
    }
    function copyState(mode, state) {
        if (state === true)
            return state;
        if (mode.copyState)
            return mode.copyState(state);
        var nstate = {};
        for (var n in state) {
            var val = state[n];
            if (val instanceof Array)
                val = val.concat([]);
            nstate[n] = val;
        }
        return nstate;
    }

    var CachedState = /** @class */ (function () {
        function CachedState(state, pos) {
            this.state = state;
            this.pos = pos;
        }
        CachedState.prototype.copy = function (mode) { return new CachedState(copyState(mode, this.state), this.pos); };
        return CachedState;
    }());
    var MAX_SCAN_DIST = 20000;
    function cutDecoratedRange(range, at) {
        if (!range || at <= range.from)
            return null;
        return { from: range.from, to: Math.min(at, range.to), decorations: range.decorations.filter(function (_a) {
                var to = _a.to;
                return to <= at;
            }) };
    }
    var StateCache = /** @class */ (function () {
        function StateCache(states, frontier, lastDecorations) {
            this.states = states;
            this.frontier = frontier;
            this.lastDecorations = lastDecorations;
        }
        StateCache.prototype.advanceFrontier = function (editorState, to, mode, sleepTime, maxWorkTime) {
            var _this = this;
            if (this.frontier >= to)
                return Promise.reject();
            clearTimeout(this.timeout);
            return new Promise(function (resolve) {
                var f = function () {
                    var endTime = +new Date + maxWorkTime;
                    do {
                        var target = Math.min(to, _this.frontier + MAX_SCAN_DIST / 2);
                        _this.getState(editorState, target, mode);
                        if (_this.frontier >= to)
                            return resolve();
                    } while (+new Date < endTime);
                    _this.timeout = setTimeout(f, sleepTime);
                };
                _this.timeout = setTimeout(f, sleepTime);
            });
        };
        StateCache.prototype.calculateDecorations = function (editorState, from, to, mode) {
            var state = this.getState(editorState, from, mode);
            var cursor = new StringStreamCursor(editorState.doc, from, editorState.tabSize);
            var states = [], decorations = [], stream = cursor.next();
            for (var i = 0; cursor.offset + stream.start < to;) {
                if (stream.eol()) {
                    stream = cursor.next();
                    if (++i % 5 == 0)
                        states.push(new CachedState(copyState(mode, state), cursor.offset));
                }
                else {
                    var style = readToken(mode, stream, state);
                    if (style)
                        decorations.push(Decoration.range(cursor.offset + stream.start, cursor.offset + stream.pos, { class: 'cm-' + style.replace(/ /g, ' cm-') }));
                    stream.start = stream.pos;
                }
            }
            this.storeStates(from, to, states);
            return decorations;
        };
        StateCache.prototype.getDecorations = function (editorState, from, to, mode) {
            var upto = from, decorations = [];
            if (this.lastDecorations) {
                if (from < this.lastDecorations.from) {
                    upto = Math.min(to, this.lastDecorations.from);
                    decorations = this.calculateDecorations(editorState, from, upto, mode);
                }
                if (upto < to && this.lastDecorations.to > upto) {
                    upto = this.lastDecorations.to;
                    decorations = decorations.concat(this.lastDecorations.decorations);
                }
            }
            if (upto < to) {
                decorations = decorations.concat(this.calculateDecorations(editorState, upto, to, mode));
            }
            this.lastDecorations = { from: from, to: to, decorations: decorations };
            return decorations;
        };
        StateCache.prototype.storeStates = function (from, to, states) {
            var _a;
            var start = this.findIndex(from), end = this.findIndex(to);
            (_a = this.states).splice.apply(_a, [start, end - start].concat(states));
            if (from <= this.frontier)
                this.frontier = Math.max(this.frontier, to);
        };
        // Return the first index for which all cached states after it have
        // a position >= pos
        StateCache.prototype.findIndex = function (pos) {
            // FIXME could be binary search
            var i = 0;
            while (i < this.states.length && this.states[i].pos < pos)
                i++;
            return i;
        };
        StateCache.prototype.stateBefore = function (pos, mode) {
            if (pos > this.frontier && pos - this.frontier < MAX_SCAN_DIST)
                pos = this.frontier;
            var index = this.findIndex(pos);
            if (index < this.states.length && this.states[index].pos == pos)
                index++;
            return index == 0 ? new CachedState(mode.startState(), 0) : this.states[index - 1].copy(mode);
        };
        StateCache.prototype.getState = function (editorState, pos, mode) {
            var _a = this.stateBefore(pos, mode), statePos = _a.pos, state = _a.state;
            if (statePos < pos - MAX_SCAN_DIST) {
                statePos = pos;
                state = mode.startState();
            }
            else if (this.lastDecorations && (statePos < this.lastDecorations.from && this.lastDecorations.from <= pos))
                // If we are calculating a correct state for a position that is after the
                // beginning of the cached decorations (which suggests that the cached
                // decorations were rendered based on an approximate state), clear that cache
                this.lastDecorations = null;
            if (statePos < pos) {
                var cursor = new StringStreamCursor(editorState.doc, statePos, editorState.tabSize);
                var stream = cursor.next();
                var start = statePos, i = 0, states = [];
                while (statePos < pos) {
                    if (stream.eol()) {
                        stream = cursor.next();
                        statePos++;
                        if (++i % 50)
                            states.push(new CachedState(copyState(mode, state), statePos));
                    }
                    else {
                        readToken(mode, stream, state);
                        statePos += stream.pos - stream.start;
                        stream.start = stream.pos;
                    }
                }
                this.storeStates(start, pos, states);
            }
            return state;
        };
        StateCache.prototype.apply = function (transaction) {
            if (transaction.changes.length == 0)
                return this;
            var start = transaction.doc.lineAt(transaction.changes.changes.reduce(function (m, ch) { return Math.min(m, ch.from); }, 1e9)).start;
            var states = [];
            for (var _i = 0, _a = this.states; _i < _a.length; _i++) {
                var cached = _a[_i];
                var mapped = transaction.changes.mapPos(cached.pos, -1, true);
                if (mapped > 0)
                    states.push(mapped == cached.pos ? cached : new CachedState(cached.state, mapped));
            }
            return new StateCache(states, Math.min(start, this.frontier), cutDecoratedRange(this.lastDecorations, start));
        };
        return StateCache;
    }());
    var legacyMode = function (config) {
        var field = new StateField({
            init: function (state) { return new StateCache([], 0, null); },
            apply: function (tr, cache) { return cache.apply(tr); }
        });
        return StateExtension.all(field.extension, ViewField.decorations(decoSpec(field, config)), StateExtension.indentation(function (state, pos) {
            if (!config.mode.indent)
                return -1;
            var modeState = state.getField(field).getState(state, pos, config.mode);
            var line = state.doc.lineAt(pos);
            return config.mode.indent(modeState, line.slice(0, Math.min(line.length, 100)).match(/^\s*(.*)/)[1]);
        })
        // FIXME add a token-retrieving behavior
        );
    };
    function decoSpec(field, config) {
        var _a = config.sleepTime, sleepTime = _a === void 0 ? 100 : _a, _b = config.maxWorkTime, maxWorkTime = _b === void 0 ? 100 : _b, mode = config.mode;
        var decorations = Decoration.none, from = -1, to = -1;
        function update(view, force) {
            var viewport = view.viewport, state = view.state;
            if (force || viewport.from < from || viewport.to > to) {
                (from = viewport.from, to = viewport.to);
                var stateCache = state.getField(field);
                decorations = Decoration.set(stateCache.getDecorations(state, from, to, mode));
                stateCache.advanceFrontier(state, from, mode, sleepTime, maxWorkTime).then(function () {
                    update(view, true);
                    view.updateState([], state); // FIXME maybe add a specific EditorView method for this
                }, function () { });
            }
            return decorations;
        }
        return {
            create: function (view) { return update(view, false); },
            update: function (_, u) { return update(u.view, u.docChanged); },
            map: false
        };
    }

    var matching = {
        "(": ")>",
        ")": "(<",
        "[": "]>",
        "]": "[<",
        "{": "}>",
        "}": "{<"
    };
    function getStyle(decorations, at) {
        if (!decorations)
            return;
        var iter = decorations.iter();
        var decoration;
        while (decoration = iter.next())
            if (decoration.from <= at && at < decoration.to)
                return decoration.value.spec.class;
    }
    function findMatchingBracket(doc, decorations, where, config) {
        var pos = where - 1;
        // A cursor is defined as between two characters, but in in vim command mode
        // (i.e. not insert mode), the cursor is visually represented as a
        // highlighted box on top of the 2nd character. Otherwise, we allow matches
        // from before or after the cursor.
        var match = (!config.afterCursor && pos >= 0 && matching[doc.slice(pos, pos + 1)]) ||
            matching[doc.slice(++pos, pos + 1)];
        if (!match)
            return null;
        var dir = match[1] == ">" ? 1 : -1;
        if (config.strict && (dir > 0) != (pos == where))
            return null;
        var style = getStyle(decorations, pos);
        var found = scanForBracket(doc, decorations, pos + (dir > 0 ? 1 : 0), dir, style || null, config);
        if (found == null)
            return null;
        return { from: pos, to: found ? found.pos : null,
            match: found && found.ch == match.charAt(0), forward: dir > 0 };
    }
    // bracketRegex is used to specify which type of bracket to scan
    // should be a regexp, e.g. /[[\]]/
    //
    // Note: If "where" is on an open bracket, then this bracket is ignored.
    //
    // Returns false when no bracket was found, null when it reached
    // maxScanDistance and gave up
    function scanForBracket(doc, decorations, where, dir, style, config) {
        var maxScanDistance = config.maxScanDistance;
        var re = config.bracketRegex;
        var stack = [];
        var iter = doc.iterRange(where, dir > 0 ? doc.length : 0);
        for (var distance = 0; !iter.done && distance <= maxScanDistance;) {
            iter.next();
            var text = iter.value;
            if (dir < 0)
                distance += text.length;
            var basePos = where + distance * dir;
            for (var pos = dir > 0 ? 0 : text.length - 1, end = dir > 0 ? text.length : -1; pos != end; pos += dir) {
                var ch = text.charAt(pos);
                if (re.test(ch) && (style === undefined || getStyle(decorations, basePos + pos) == style)) {
                    var match = matching[ch];
                    if ((match.charAt(1) == ">") == (dir > 0))
                        stack.push(ch);
                    else if (!stack.length)
                        return { pos: basePos + pos, ch: ch };
                    else
                        stack.pop();
                }
            }
            if (dir > 0)
                distance += text.length;
        }
        return iter.done ? false : null;
    }
    function doMatchBrackets(state, referenceDecorations, config) {
        var decorations = [];
        for (var _i = 0, _a = state.selection.ranges; _i < _a.length; _i++) {
            var range = _a[_i];
            if (!range.empty)
                continue;
            var match = findMatchingBracket(state.doc, referenceDecorations, range.head, config);
            if (!match)
                continue;
            var style = match.match ? defaultStyles.matching : defaultStyles.nonmatching;
            decorations.push(Decoration.range(match.from, match.from + 1, { class: style }));
            if (match.to)
                decorations.push(Decoration.range(match.to, match.to + 1, { class: style }));
        }
        return Decoration.set(decorations);
    }
    var matchBrackets = ViewExtension.unique(function (configs) {
        var config = combineConfig(configs, {
            afterCursor: false,
            bracketRegex: /[(){}[\]]/,
            maxScanDistance: 10000,
            strict: false
        });
        return ViewExtension.all(ViewField.decorations({
            create: function () { return Decoration.none; },
            update: function (deco, update) {
                // FIXME make this use a tokenizer behavior exported by the highlighter
                return update.transactions.length ? doMatchBrackets(update.state, undefined, config) : deco;
            }
        }), styleModule(defaultStyles));
    }, {});
    // FIXME themeability
    var defaultStyles = new styleMod_1({
        matching: { color: "#0b0" },
        nonmatching: { color: "#a22" }
    });

    // CodeMirror, copyright (c) by Marijn Haverbeke and others

    function javascript(config, parserConfig) {
      var indentUnit = config.indentUnit;
      var statementIndent = parserConfig.statementIndent;
      var jsonldMode = parserConfig.jsonld;
      var jsonMode = parserConfig.json || jsonldMode;
      var isTS = parserConfig.typescript;
      var wordRE = parserConfig.wordCharacters || /[\w$\xa1-\uffff]/;

      // Tokenizer

      var keywords = function(){
        function kw(type) {return {type: type, style: "keyword"};}
        var A = kw("keyword a"), B = kw("keyword b"), C = kw("keyword c"), D = kw("keyword d");
        var operator = kw("operator"), atom = {type: "atom", style: "atom"};

        return {
          "if": kw("if"), "while": A, "with": A, "else": B, "do": B, "try": B, "finally": B,
          "return": D, "break": D, "continue": D, "new": kw("new"), "delete": C, "void": C, "throw": C,
          "debugger": kw("debugger"), "var": kw("var"), "const": kw("var"), "let": kw("var"),
          "function": kw("function"), "catch": kw("catch"),
          "for": kw("for"), "switch": kw("switch"), "case": kw("case"), "default": kw("default"),
          "in": operator, "typeof": operator, "instanceof": operator,
          "true": atom, "false": atom, "null": atom, "undefined": atom, "NaN": atom, "Infinity": atom,
          "this": kw("this"), "class": kw("class"), "super": kw("atom"),
          "yield": C, "export": kw("export"), "import": kw("import"), "extends": C,
          "await": C
        };
      }();

      var isOperatorChar = /[+\-*&%=<>!?|~^@]/;
      var isJsonldKeyword = /^@(context|id|value|language|type|container|list|set|reverse|index|base|vocab|graph)"/;

      function readRegexp(stream) {
        var escaped = false, next, inSet = false;
        while ((next = stream.next()) != null) {
          if (!escaped) {
            if (next == "/" && !inSet) return;
            if (next == "[") inSet = true;
            else if (inSet && next == "]") inSet = false;
          }
          escaped = !escaped && next == "\\";
        }
      }

      // Used as scratch variables to communicate multiple values without
      // consing up tons of objects.
      var type, content;
      function ret(tp, style, cont) {
        type = tp; content = cont;
        return style;
      }
      function tokenBase(stream, state) {
        var ch = stream.next();
        if (ch == '"' || ch == "'") {
          state.tokenize = tokenString(ch);
          return state.tokenize(stream, state);
        } else if (ch == "." && stream.match(/^\d+(?:[eE][+\-]?\d+)?/)) {
          return ret("number", "number");
        } else if (ch == "." && stream.match("..")) {
          return ret("spread", "meta");
        } else if (/[\[\]{}\(\),;\:\.]/.test(ch)) {
          return ret(ch);
        } else if (ch == "=" && stream.eat(">")) {
          return ret("=>", "operator");
        } else if (ch == "0" && stream.eat(/x/i)) {
          stream.eatWhile(/[\da-f]/i);
          return ret("number", "number");
        } else if (ch == "0" && stream.eat(/o/i)) {
          stream.eatWhile(/[0-7]/i);
          return ret("number", "number");
        } else if (ch == "0" && stream.eat(/b/i)) {
          stream.eatWhile(/[01]/i);
          return ret("number", "number");
        } else if (/\d/.test(ch)) {
          stream.match(/^\d*(?:\.\d*)?(?:[eE][+\-]?\d+)?/);
          return ret("number", "number");
        } else if (ch == "/") {
          if (stream.eat("*")) {
            state.tokenize = tokenComment;
            return tokenComment(stream, state);
          } else if (stream.eat("/")) {
            stream.skipToEnd();
            return ret("comment", "comment");
          } else if (expressionAllowed(stream, state, 1)) {
            readRegexp(stream);
            stream.match(/^\b(([gimyu])(?![gimyu]*\2))+\b/);
            return ret("regexp", "string-2");
          } else {
            stream.eat("=");
            return ret("operator", "operator", stream.current());
          }
        } else if (ch == "`") {
          state.tokenize = tokenQuasi;
          return tokenQuasi(stream, state);
        } else if (ch == "#") {
          stream.skipToEnd();
          return ret("error", "error");
        } else if (isOperatorChar.test(ch)) {
          if (ch != ">" || !state.lexical || state.lexical.type != ">") {
            if (stream.eat("=")) {
              if (ch == "!" || ch == "=") stream.eat("=");
            } else if (/[<>*+\-]/.test(ch)) {
              stream.eat(ch);
              if (ch == ">") stream.eat(ch);
            }
          }
          return ret("operator", "operator", stream.current());
        } else if (wordRE.test(ch)) {
          stream.eatWhile(wordRE);
          var word = stream.current();
          if (state.lastType != ".") {
            if (keywords.propertyIsEnumerable(word)) {
              var kw = keywords[word];
              return ret(kw.type, kw.style, word)
            }
            if (word == "async" && stream.match(/^(\s|\/\*.*?\*\/)*[\(\w]/, false))
              return ret("async", "keyword", word)
          }
          return ret("variable", "variable", word)
        }
      }

      function tokenString(quote) {
        return function(stream, state) {
          var escaped = false, next;
          if (jsonldMode && stream.peek() == "@" && stream.match(isJsonldKeyword)){
            state.tokenize = tokenBase;
            return ret("jsonld-keyword", "meta");
          }
          while ((next = stream.next()) != null) {
            if (next == quote && !escaped) break;
            escaped = !escaped && next == "\\";
          }
          if (!escaped) state.tokenize = tokenBase;
          return ret("string", "string");
        };
      }

      function tokenComment(stream, state) {
        var maybeEnd = false, ch;
        while (ch = stream.next()) {
          if (ch == "/" && maybeEnd) {
            state.tokenize = tokenBase;
            break;
          }
          maybeEnd = (ch == "*");
        }
        return ret("comment", "comment");
      }

      function tokenQuasi(stream, state) {
        var escaped = false, next;
        while ((next = stream.next()) != null) {
          if (!escaped && (next == "`" || next == "$" && stream.eat("{"))) {
            state.tokenize = tokenBase;
            break;
          }
          escaped = !escaped && next == "\\";
        }
        return ret("quasi", "string-2", stream.current());
      }

      var brackets = "([{}])";
      // This is a crude lookahead trick to try and notice that we're
      // parsing the argument patterns for a fat-arrow function before we
      // actually hit the arrow token. It only works if the arrow is on
      // the same line as the arguments and there's no strange noise
      // (comments) in between. Fallback is to only notice when we hit the
      // arrow, and not declare the arguments as locals for the arrow
      // body.
      function findFatArrow(stream, state) {
        if (state.fatArrowAt) state.fatArrowAt = null;
        var arrow = stream.string.indexOf("=>", stream.start);
        if (arrow < 0) return;

        if (isTS) { // Try to skip TypeScript return type declarations after the arguments
          var m = /:\s*(?:\w+(?:<[^>]*>|\[\])?|\{[^}]*\})\s*$/.exec(stream.string.slice(stream.start, arrow));
          if (m) arrow = m.index;
        }

        var depth = 0, sawSomething = false;
        for (var pos = arrow - 1; pos >= 0; --pos) {
          var ch = stream.string.charAt(pos);
          var bracket = brackets.indexOf(ch);
          if (bracket >= 0 && bracket < 3) {
            if (!depth) { ++pos; break; }
            if (--depth == 0) { if (ch == "(") sawSomething = true; break; }
          } else if (bracket >= 3 && bracket < 6) {
            ++depth;
          } else if (wordRE.test(ch)) {
            sawSomething = true;
          } else if (/["'\/]/.test(ch)) {
            return;
          } else if (sawSomething && !depth) {
            ++pos;
            break;
          }
        }
        if (sawSomething && !depth) state.fatArrowAt = pos;
      }

      // Parser

      var atomicTypes = {"atom": true, "number": true, "variable": true, "string": true, "regexp": true, "this": true, "jsonld-keyword": true};

      function JSLexical(indented, column, type, align, prev, info) {
        this.indented = indented;
        this.column = column;
        this.type = type;
        this.prev = prev;
        this.info = info;
        if (align != null) this.align = align;
      }

      function inScope(state, varname) {
        for (var v = state.localVars; v; v = v.next)
          if (v.name == varname) return true;
        for (var cx = state.context; cx; cx = cx.prev) {
          for (var v = cx.vars; v; v = v.next)
            if (v.name == varname) return true;
        }
      }

      function parseJS(state, style, type, content, stream) {
        var cc = state.cc;
        // Communicate our context to the combinators.
        // (Less wasteful than consing up a hundred closures on every call.)
        cx.state = state; cx.stream = stream; cx.marked = null, cx.cc = cc; cx.style = style;

        if (!state.lexical.hasOwnProperty("align"))
          state.lexical.align = true;

        while(true) {
          var combinator = cc.length ? cc.pop() : jsonMode ? expression : statement;
          if (combinator(type, content)) {
            while(cc.length && cc[cc.length - 1].lex)
              cc.pop()();
            if (cx.marked) return cx.marked;
            if (type == "variable" && inScope(state, content)) return "variable-2";
            return style;
          }
        }
      }

      // Combinator utils

      var cx = {state: null, column: null, marked: null, cc: null};
      function pass() {
        for (var i = arguments.length - 1; i >= 0; i--) cx.cc.push(arguments[i]);
      }
      function cont() {
        pass.apply(null, arguments);
        return true;
      }
      function register(varname) {
        function inList(list) {
          for (var v = list; v; v = v.next)
            if (v.name == varname) return true;
          return false;
        }
        var state = cx.state;
        cx.marked = "def";
        if (state.context) {
          if (inList(state.localVars)) return;
          state.localVars = {name: varname, next: state.localVars};
        } else {
          if (inList(state.globalVars)) return;
          if (parserConfig.globalVars)
            state.globalVars = {name: varname, next: state.globalVars};
        }
      }

      function isModifier(name) {
        return name == "public" || name == "private" || name == "protected" || name == "abstract" || name == "readonly"
      }

      // Combinators

      var defaultVars = {name: "this", next: {name: "arguments"}};
      function pushcontext() {
        cx.state.context = {prev: cx.state.context, vars: cx.state.localVars};
        cx.state.localVars = defaultVars;
      }
      function popcontext() {
        cx.state.localVars = cx.state.context.vars;
        cx.state.context = cx.state.context.prev;
      }
      function pushlex(type, info) {
        var result = function() {
          var state = cx.state, indent = state.indented;
          if (state.lexical.type == "stat") indent = state.lexical.indented;
          else for (var outer = state.lexical; outer && outer.type == ")" && outer.align; outer = outer.prev)
            indent = outer.indented;
          state.lexical = new JSLexical(indent, cx.stream.column(), type, null, state.lexical, info);
        };
        result.lex = true;
        return result;
      }
      function poplex() {
        var state = cx.state;
        if (state.lexical.prev) {
          if (state.lexical.type == ")")
            state.indented = state.lexical.indented;
          state.lexical = state.lexical.prev;
        }
      }
      poplex.lex = true;

      function expect(wanted) {
        function exp(type) {
          if (type == wanted) return cont();
          else if (wanted == ";") return pass();
          else return cont(exp);
        }    return exp;
      }

      function statement(type, value) {
        if (type == "var") return cont(pushlex("vardef", value.length), vardef, expect(";"), poplex);
        if (type == "keyword a") return cont(pushlex("form"), parenExpr, statement, poplex);
        if (type == "keyword b") return cont(pushlex("form"), statement, poplex);
        if (type == "keyword d") return cx.stream.match(/^\s*$/, false) ? cont() : cont(pushlex("stat"), maybeexpression, expect(";"), poplex);
        if (type == "debugger") return cont(expect(";"));
        if (type == "{") return cont(pushlex("}"), block, poplex);
        if (type == ";") return cont();
        if (type == "if") {
          if (cx.state.lexical.info == "else" && cx.state.cc[cx.state.cc.length - 1] == poplex)
            cx.state.cc.pop()();
          return cont(pushlex("form"), parenExpr, statement, poplex, maybeelse);
        }
        if (type == "function") return cont(functiondef);
        if (type == "for") return cont(pushlex("form"), forspec, statement, poplex);
        if (type == "class" || (isTS && value == "interface")) { cx.marked = "keyword"; return cont(pushlex("form"), className, poplex); }
        if (type == "variable") {
          if (isTS && value == "declare") {
            cx.marked = "keyword";
            return cont(statement)
          } else if (isTS && (value == "module" || value == "enum" || value == "type") && cx.stream.match(/^\s*\w/, false)) {
            cx.marked = "keyword";
            if (value == "enum") return cont(enumdef);
            else if (value == "type") return cont(typeexpr, expect("operator"), typeexpr, expect(";"));
            else return cont(pushlex("form"), pattern, expect("{"), pushlex("}"), block, poplex, poplex)
          } else if (isTS && value == "namespace") {
            cx.marked = "keyword";
            return cont(pushlex("form"), expression, block, poplex)
          } else if (isTS && value == "abstract") {
            cx.marked = "keyword";
            return cont(statement)
          } else {
            return cont(pushlex("stat"), maybelabel);
          }
        }
        if (type == "switch") return cont(pushlex("form"), parenExpr, expect("{"), pushlex("}", "switch"),
                                          block, poplex, poplex);
        if (type == "case") return cont(expression, expect(":"));
        if (type == "default") return cont(expect(":"));
        if (type == "catch") return cont(pushlex("form"), pushcontext, expect("("), funarg, expect(")"),
                                         statement, poplex, popcontext);
        if (type == "export") return cont(pushlex("stat"), afterExport, poplex);
        if (type == "import") return cont(pushlex("stat"), afterImport, poplex);
        if (type == "async") return cont(statement)
        if (value == "@") return cont(expression, statement)
        return pass(pushlex("stat"), expression, expect(";"), poplex);
      }
      function expression(type, value) {
        return expressionInner(type, value, false);
      }
      function expressionNoComma(type, value) {
        return expressionInner(type, value, true);
      }
      function parenExpr(type) {
        if (type != "(") return pass()
        return cont(pushlex(")"), expression, expect(")"), poplex)
      }
      function expressionInner(type, value, noComma) {
        if (cx.state.fatArrowAt == cx.stream.start) {
          var body = noComma ? arrowBodyNoComma : arrowBody;
          if (type == "(") return cont(pushcontext, pushlex(")"), commasep(funarg, ")"), poplex, expect("=>"), body, popcontext);
          else if (type == "variable") return pass(pushcontext, pattern, expect("=>"), body, popcontext);
        }

        var maybeop = noComma ? maybeoperatorNoComma : maybeoperatorComma;
        if (atomicTypes.hasOwnProperty(type)) return cont(maybeop);
        if (type == "function") return cont(functiondef, maybeop);
        if (type == "class" || (isTS && value == "interface")) { cx.marked = "keyword"; return cont(pushlex("form"), classExpression, poplex); }
        if (type == "keyword c" || type == "async") return cont(noComma ? expressionNoComma : expression);
        if (type == "(") return cont(pushlex(")"), maybeexpression, expect(")"), poplex, maybeop);
        if (type == "operator" || type == "spread") return cont(noComma ? expressionNoComma : expression);
        if (type == "[") return cont(pushlex("]"), arrayLiteral, poplex, maybeop);
        if (type == "{") return contCommasep(objprop, "}", null, maybeop);
        if (type == "quasi") return pass(quasi, maybeop);
        if (type == "new") return cont(maybeTarget(noComma));
        if (type == "import") return cont(expression);
        return cont();
      }
      function maybeexpression(type) {
        if (type.match(/[;\}\)\],]/)) return pass();
        return pass(expression);
      }

      function maybeoperatorComma(type, value) {
        if (type == ",") return cont(expression);
        return maybeoperatorNoComma(type, value, false);
      }
      function maybeoperatorNoComma(type, value, noComma) {
        var me = noComma == false ? maybeoperatorComma : maybeoperatorNoComma;
        var expr = noComma == false ? expression : expressionNoComma;
        if (type == "=>") return cont(pushcontext, noComma ? arrowBodyNoComma : arrowBody, popcontext);
        if (type == "operator") {
          if (/\+\+|--/.test(value) || isTS && value == "!") return cont(me);
          if (isTS && value == "<" && cx.stream.match(/^([^>]|<.*?>)*>\s*\(/, false))
            return cont(pushlex(">"), commasep(typeexpr, ">"), poplex, me);
          if (value == "?") return cont(expression, expect(":"), expr);
          return cont(expr);
        }
        if (type == "quasi") { return pass(quasi, me); }
        if (type == ";") return;
        if (type == "(") return contCommasep(expressionNoComma, ")", "call", me);
        if (type == ".") return cont(property, me);
        if (type == "[") return cont(pushlex("]"), maybeexpression, expect("]"), poplex, me);
        if (isTS && value == "as") { cx.marked = "keyword"; return cont(typeexpr, me) }
        if (type == "regexp") {
          cx.state.lastType = cx.marked = "operator";
          cx.stream.backUp(cx.stream.pos - cx.stream.start - 1);
          return cont(expr)
        }
      }
      function quasi(type, value) {
        if (type != "quasi") return pass();
        if (value.slice(value.length - 2) != "${") return cont(quasi);
        return cont(expression, continueQuasi);
      }
      function continueQuasi(type) {
        if (type == "}") {
          cx.marked = "string-2";
          cx.state.tokenize = tokenQuasi;
          return cont(quasi);
        }
      }
      function arrowBody(type) {
        findFatArrow(cx.stream, cx.state);
        return pass(type == "{" ? statement : expression);
      }
      function arrowBodyNoComma(type) {
        findFatArrow(cx.stream, cx.state);
        return pass(type == "{" ? statement : expressionNoComma);
      }
      function maybeTarget(noComma) {
        return function(type) {
          if (type == ".") return cont(noComma ? targetNoComma : target);
          else if (type == "variable" && isTS) return cont(maybeTypeArgs, noComma ? maybeoperatorNoComma : maybeoperatorComma)
          else return pass(noComma ? expressionNoComma : expression);
        };
      }
      function target(_, value) {
        if (value == "target") { cx.marked = "keyword"; return cont(maybeoperatorComma); }
      }
      function targetNoComma(_, value) {
        if (value == "target") { cx.marked = "keyword"; return cont(maybeoperatorNoComma); }
      }
      function maybelabel(type) {
        if (type == ":") return cont(poplex, statement);
        return pass(maybeoperatorComma, expect(";"), poplex);
      }
      function property(type) {
        if (type == "variable") {cx.marked = "property"; return cont();}
      }
      function objprop(type, value) {
        if (type == "async") {
          cx.marked = "property";
          return cont(objprop);
        } else if (type == "variable" || cx.style == "keyword") {
          cx.marked = "property";
          if (value == "get" || value == "set") return cont(getterSetter);
          var m; // Work around fat-arrow-detection complication for detecting typescript typed arrow params
          if (isTS && cx.state.fatArrowAt == cx.stream.start && (m = cx.stream.match(/^\s*:\s*/, false)))
            cx.state.fatArrowAt = cx.stream.pos + m[0].length;
          return cont(afterprop);
        } else if (type == "number" || type == "string") {
          cx.marked = jsonldMode ? "property" : (cx.style + " property");
          return cont(afterprop);
        } else if (type == "jsonld-keyword") {
          return cont(afterprop);
        } else if (isTS && isModifier(value)) {
          cx.marked = "keyword";
          return cont(objprop)
        } else if (type == "[") {
          return cont(expression, maybetype, expect("]"), afterprop);
        } else if (type == "spread") {
          return cont(expressionNoComma, afterprop);
        } else if (value == "*") {
          cx.marked = "keyword";
          return cont(objprop);
        } else if (type == ":") {
          return pass(afterprop)
        }
      }
      function getterSetter(type) {
        if (type != "variable") return pass(afterprop);
        cx.marked = "property";
        return cont(functiondef);
      }
      function afterprop(type) {
        if (type == ":") return cont(expressionNoComma);
        if (type == "(") return pass(functiondef);
      }
      function commasep(what, end, sep) {
        function proceed(type, value) {
          if (sep ? sep.indexOf(type) > -1 : type == ",") {
            var lex = cx.state.lexical;
            if (lex.info == "call") lex.pos = (lex.pos || 0) + 1;
            return cont(function(type, value) {
              if (type == end || value == end) return pass()
              return pass(what)
            }, proceed);
          }
          if (type == end || value == end) return cont();
          return cont(expect(end));
        }
        return function(type, value) {
          if (type == end || value == end) return cont();
          return pass(what, proceed);
        };
      }
      function contCommasep(what, end, info) {
        for (var i = 3; i < arguments.length; i++)
          cx.cc.push(arguments[i]);
        return cont(pushlex(end, info), commasep(what, end), poplex);
      }
      function block(type) {
        if (type == "}") return cont();
        return pass(statement, block);
      }
      function maybetype(type, value) {
        if (isTS) {
          if (type == ":") return cont(typeexpr);
          if (value == "?") return cont(maybetype);
        }
      }
      function mayberettype(type) {
        if (isTS && type == ":") {
          if (cx.stream.match(/^\s*\w+\s+is\b/, false)) return cont(expression, isKW, typeexpr)
          else return cont(typeexpr)
        }
      }
      function isKW(_, value) {
        if (value == "is") {
          cx.marked = "keyword";
          return cont()
        }
      }
      function typeexpr(type, value) {
        if (value == "keyof" || value == "typeof") {
          cx.marked = "keyword";
          return cont(value == "keyof" ? typeexpr : expressionNoComma)
        }
        if (type == "variable" || value == "void") {
          cx.marked = "type";
          return cont(afterType)
        }
        if (type == "string" || type == "number" || type == "atom") return cont(afterType);
        if (type == "[") return cont(pushlex("]"), commasep(typeexpr, "]", ","), poplex, afterType)
        if (type == "{") return cont(pushlex("}"), commasep(typeprop, "}", ",;"), poplex, afterType)
        if (type == "(") return cont(commasep(typearg, ")"), maybeReturnType)
        if (type == "<") return cont(commasep(typeexpr, ">"), typeexpr)
      }
      function maybeReturnType(type) {
        if (type == "=>") return cont(typeexpr)
      }
      function typeprop(type, value) {
        if (type == "variable" || cx.style == "keyword") {
          cx.marked = "property";
          return cont(typeprop)
        } else if (value == "?") {
          return cont(typeprop)
        } else if (type == ":") {
          return cont(typeexpr)
        } else if (type == "[") {
          return cont(expression, maybetype, expect("]"), typeprop)
        }
      }
      function typearg(type, value) {
        if (type == "variable" && cx.stream.match(/^\s*[?:]/, false) || value == "?") return cont(typearg)
        if (type == ":") return cont(typeexpr)
        return pass(typeexpr)
      }
      function afterType(type, value) {
        if (value == "<") return cont(pushlex(">"), commasep(typeexpr, ">"), poplex, afterType)
        if (value == "|" || type == "." || value == "&") return cont(typeexpr)
        if (type == "[") return cont(expect("]"), afterType)
        if (value == "extends" || value == "implements") { cx.marked = "keyword"; return cont(typeexpr) }
      }
      function maybeTypeArgs(_, value) {
        if (value == "<") return cont(pushlex(">"), commasep(typeexpr, ">"), poplex, afterType)
      }
      function typeparam() {
        return pass(typeexpr, maybeTypeDefault)
      }
      function maybeTypeDefault(_, value) {
        if (value == "=") return cont(typeexpr)
      }
      function vardef(_, value) {
        if (value == "enum") {cx.marked = "keyword"; return cont(enumdef)}
        return pass(pattern, maybetype, maybeAssign, vardefCont);
      }
      function pattern(type, value) {
        if (isTS && isModifier(value)) { cx.marked = "keyword"; return cont(pattern) }
        if (type == "variable") { register(value); return cont(); }
        if (type == "spread") return cont(pattern);
        if (type == "[") return contCommasep(pattern, "]");
        if (type == "{") return contCommasep(proppattern, "}");
      }
      function proppattern(type, value) {
        if (type == "variable" && !cx.stream.match(/^\s*:/, false)) {
          register(value);
          return cont(maybeAssign);
        }
        if (type == "variable") cx.marked = "property";
        if (type == "spread") return cont(pattern);
        if (type == "}") return pass();
        return cont(expect(":"), pattern, maybeAssign);
      }
      function maybeAssign(_type, value) {
        if (value == "=") return cont(expressionNoComma);
      }
      function vardefCont(type) {
        if (type == ",") return cont(vardef);
      }
      function maybeelse(type, value) {
        if (type == "keyword b" && value == "else") return cont(pushlex("form", "else"), statement, poplex);
      }
      function forspec(type, value) {
        if (value == "await") return cont(forspec);
        if (type == "(") return cont(pushlex(")"), forspec1, expect(")"), poplex);
      }
      function forspec1(type) {
        if (type == "var") return cont(vardef, expect(";"), forspec2);
        if (type == ";") return cont(forspec2);
        if (type == "variable") return cont(formaybeinof);
        return pass(expression, expect(";"), forspec2);
      }
      function formaybeinof(_type, value) {
        if (value == "in" || value == "of") { cx.marked = "keyword"; return cont(expression); }
        return cont(maybeoperatorComma, forspec2);
      }
      function forspec2(type, value) {
        if (type == ";") return cont(forspec3);
        if (value == "in" || value == "of") { cx.marked = "keyword"; return cont(expression); }
        return pass(expression, expect(";"), forspec3);
      }
      function forspec3(type) {
        if (type != ")") cont(expression);
      }
      function functiondef(type, value) {
        if (value == "*") {cx.marked = "keyword"; return cont(functiondef);}
        if (type == "variable") {register(value); return cont(functiondef);}
        if (type == "(") return cont(pushcontext, pushlex(")"), commasep(funarg, ")"), poplex, mayberettype, statement, popcontext);
        if (isTS && value == "<") return cont(pushlex(">"), commasep(typeparam, ">"), poplex, functiondef)
      }
      function funarg(type, value) {
        if (value == "@") cont(expression, funarg);
        if (type == "spread") return cont(funarg);
        if (isTS && isModifier(value)) { cx.marked = "keyword"; return cont(funarg); }
        return pass(pattern, maybetype, maybeAssign);
      }
      function classExpression(type, value) {
        // Class expressions may have an optional name.
        if (type == "variable") return className(type, value);
        return classNameAfter(type, value);
      }
      function className(type, value) {
        if (type == "variable") {register(value); return cont(classNameAfter);}
      }
      function classNameAfter(type, value) {
        if (value == "<") return cont(pushlex(">"), commasep(typeparam, ">"), poplex, classNameAfter)
        if (value == "extends" || value == "implements" || (isTS && type == ",")) {
          if (value == "implements") cx.marked = "keyword";
          return cont(isTS ? typeexpr : expression, classNameAfter);
        }
        if (type == "{") return cont(pushlex("}"), classBody, poplex);
      }
      function classBody(type, value) {
        if (type == "async" ||
            (type == "variable" &&
             (value == "static" || value == "get" || value == "set" || (isTS && isModifier(value))) &&
             cx.stream.match(/^\s+[\w$\xa1-\uffff]/, false))) {
          cx.marked = "keyword";
          return cont(classBody);
        }
        if (type == "variable" || cx.style == "keyword") {
          cx.marked = "property";
          return cont(isTS ? classfield : functiondef, classBody);
        }
        if (type == "[")
          return cont(expression, maybetype, expect("]"), isTS ? classfield : functiondef, classBody)
        if (value == "*") {
          cx.marked = "keyword";
          return cont(classBody);
        }
        if (type == ";") return cont(classBody);
        if (type == "}") return cont();
        if (value == "@") return cont(expression, classBody)
      }
      function classfield(type, value) {
        if (value == "?") return cont(classfield)
        if (type == ":") return cont(typeexpr, maybeAssign)
        if (value == "=") return cont(expressionNoComma)
        return pass(functiondef)
      }
      function afterExport(type, value) {
        if (value == "*") { cx.marked = "keyword"; return cont(maybeFrom, expect(";")); }
        if (value == "default") { cx.marked = "keyword"; return cont(expression, expect(";")); }
        if (type == "{") return cont(commasep(exportField, "}"), maybeFrom, expect(";"));
        return pass(statement);
      }
      function exportField(type, value) {
        if (value == "as") { cx.marked = "keyword"; return cont(expect("variable")); }
        if (type == "variable") return pass(expressionNoComma, exportField);
      }
      function afterImport(type) {
        if (type == "string") return cont();
        if (type == "(") return pass(expression);
        return pass(importSpec, maybeMoreImports, maybeFrom);
      }
      function importSpec(type, value) {
        if (type == "{") return contCommasep(importSpec, "}");
        if (type == "variable") register(value);
        if (value == "*") cx.marked = "keyword";
        return cont(maybeAs);
      }
      function maybeMoreImports(type) {
        if (type == ",") return cont(importSpec, maybeMoreImports)
      }
      function maybeAs(_type, value) {
        if (value == "as") { cx.marked = "keyword"; return cont(importSpec); }
      }
      function maybeFrom(_type, value) {
        if (value == "from") { cx.marked = "keyword"; return cont(expression); }
      }
      function arrayLiteral(type) {
        if (type == "]") return cont();
        return pass(commasep(expressionNoComma, "]"));
      }
      function enumdef() {
        return pass(pushlex("form"), pattern, expect("{"), pushlex("}"), commasep(enummember, "}"), poplex, poplex)
      }
      function enummember() {
        return pass(pattern, maybeAssign);
      }

      function isContinuedStatement(state, textAfter) {
        return state.lastType == "operator" || state.lastType == "," ||
          isOperatorChar.test(textAfter.charAt(0)) ||
          /[,.]/.test(textAfter.charAt(0));
      }

      function expressionAllowed(stream, state, backUp) {
        return state.tokenize == tokenBase &&
          /^(?:operator|sof|keyword [bcd]|case|new|export|default|spread|[\[{}\(,;:]|=>)$/.test(state.lastType) ||
          (state.lastType == "quasi" && /\{\s*$/.test(stream.string.slice(0, stream.pos - (backUp || 0))))
      }

      // Interface

      return {
        startState: function(basecolumn) {
          var state = {
            tokenize: tokenBase,
            lastType: "sof",
            cc: [],
            lexical: new JSLexical((basecolumn || 0) - indentUnit, 0, "block", false),
            localVars: parserConfig.localVars,
            context: parserConfig.localVars && {vars: parserConfig.localVars},
            indented: basecolumn || 0
          };
          if (parserConfig.globalVars && typeof parserConfig.globalVars == "object")
            state.globalVars = parserConfig.globalVars;
          return state;
        },

        token: function(stream, state) {
          if (stream.sol()) {
            if (!state.lexical.hasOwnProperty("align"))
              state.lexical.align = false;
            state.indented = stream.indentation();
            findFatArrow(stream, state);
          }
          if (state.tokenize != tokenComment && stream.eatSpace()) return null;
          var style = state.tokenize(stream, state);
          if (type == "comment") return style;
          state.lastType = type == "operator" && (content == "++" || content == "--") ? "incdec" : type;
          return parseJS(state, style, type, content, stream);
        },

        indent: function(state, textAfter) {
          if (state.tokenize == tokenComment) return -1;
          if (state.tokenize != tokenBase) return 0;
          var firstChar = textAfter && textAfter.charAt(0), lexical = state.lexical, top;
          // Kludge to prevent 'maybeelse' from blocking lexical scope pops
          if (!/^\s*else\b/.test(textAfter)) for (var i = state.cc.length - 1; i >= 0; --i) {
            var c = state.cc[i];
            if (c == poplex) lexical = lexical.prev;
            else if (c != maybeelse) break;
          }
          while ((lexical.type == "stat" || lexical.type == "form") &&
                 (firstChar == "}" || ((top = state.cc[state.cc.length - 1]) &&
                                       (top == maybeoperatorComma || top == maybeoperatorNoComma) &&
                                       !/^[,\.=+\-*:?[\(]/.test(textAfter))))
            lexical = lexical.prev;
          if (statementIndent && lexical.type == ")" && lexical.prev.type == "stat")
            lexical = lexical.prev;
          var type = lexical.type, closing = firstChar == type;

          if (type == "vardef") return lexical.indented + (state.lastType == "operator" || state.lastType == "," ? lexical.info + 1 : 0);
          else if (type == "form" && firstChar == "{") return lexical.indented;
          else if (type == "form") return lexical.indented + indentUnit;
          else if (type == "stat")
            return lexical.indented + (isContinuedStatement(state, textAfter) ? statementIndent || indentUnit : 0);
          else if (lexical.info == "switch" && !closing && parserConfig.doubleIndentSwitch != false)
            return lexical.indented + (/^(?:case|default)\b/.test(textAfter) ? indentUnit : 2 * indentUnit);
          else if (lexical.align) return lexical.column + (closing ? 0 : 1);
          else return lexical.indented + (closing ? 0 : indentUnit);
        },

        electricInput: /^\s*(?:case .*?:|default:|\{|\})$/,
        blockCommentStart: jsonMode ? null : "/*",
        blockCommentEnd: jsonMode ? null : "*/",
        blockCommentContinue: jsonMode ? null : " * ",
        lineComment: jsonMode ? null : "//",
        fold: "brace",
        closeBrackets: "()[]{}''\"\"``",

        helperType: jsonMode ? "json" : "javascript",
        jsonldMode: jsonldMode,
        jsonMode: jsonMode,

        expressionAllowed: expressionAllowed,

        skipExpression: function(state) {
          var top = state.cc[state.cc.length - 1];
          if (top == expression || top == expressionNoComma) state.cc.pop();
        }
      };
    }

    /*
    CodeMirror.registerHelper("wordChars", "javascript", /[\w$]/);

    CodeMirror.defineMIME("text/javascript", "javascript");
    CodeMirror.defineMIME("text/ecmascript", "javascript");
    CodeMirror.defineMIME("application/javascript", "javascript");
    CodeMirror.defineMIME("application/x-javascript", "javascript");
    CodeMirror.defineMIME("application/ecmascript", "javascript");
    CodeMirror.defineMIME("application/json", {name: "javascript", json: true});
    CodeMirror.defineMIME("application/x-json", {name: "javascript", json: true});
    CodeMirror.defineMIME("application/ld+json", {name: "javascript", jsonld: true});
    CodeMirror.defineMIME("text/typescript", { name: "javascript", typescript: true });
    CodeMirror.defineMIME("application/typescript", { name: "javascript", typescript: true });
    */

    var specialChars = ViewExtension.unique(function (configs) {
        // FIXME make configurations compose properly
        var config = combineConfig(configs, {
            render: undefined,
            specialChars: SPECIALS,
            addSpecialChars: undefined
        });
        return new ViewField({
            create: function (view) { return new SpecialCharHighlighter(view, config); },
            update: function (self, update) { return self.update(update); },
            effects: [ViewField.decorationEffect(function (self) { return self.decorations; })]
        }).extension;
    }, {});
    var JOIN_GAP = 10;
    var SpecialCharHighlighter = /** @class */ (function () {
        function SpecialCharHighlighter(view, options) {
            this.view = view;
            this.options = options;
            this.decorations = Decoration.none;
            this.from = 0;
            this.to = 0;
            this.updateForViewport();
            this.specials = options.specialChars;
            if (options.addSpecialChars)
                this.specials = new RegExp(this.specials.source + "|" + options.addSpecialChars.source, "gu");
            var styles = document.body.style;
            if (this.replaceTabs = (styles.tabSize || styles.MozTabSize) == null)
                this.specials = new RegExp("\t|" + this.specials.source, "gu");
        }
        SpecialCharHighlighter.prototype.update = function (update) {
            if (this.replaceTabs && update.transactions.some(function (tr) { return tr.getMeta(Transaction.changeTabSize) != null; })) {
                this.decorations = Decoration.none;
                this.from = this.to = 0;
            }
            else {
                var allChanges = update.transactions.reduce(function (ch, tr) { return ch.appendSet(tr.changes); }, ChangeSet.empty);
                if (allChanges.length) {
                    this.decorations = this.decorations.map(allChanges);
                    this.from = allChanges.mapPos(this.from, 1);
                    this.to = allChanges.mapPos(this.to, -1);
                    this.closeHoles(allChanges.changedRanges());
                }
            }
            this.updateForViewport();
            return this;
        };
        SpecialCharHighlighter.prototype.closeHoles = function (ranges) {
            var decorations = [], vp = this.view.viewport, replaced = [];
            for (var i = 0; i < ranges.length; i++) {
                var _a = ranges[i], from = _a.fromB, to = _a.toB;
                // Must redraw all tabs further on the line
                if (this.replaceTabs)
                    to = this.view.state.doc.lineAt(to).end;
                while (i < ranges.length - 1 && ranges[i + 1].fromB < to + JOIN_GAP)
                    to = Math.max(to, ranges[++i].toB);
                // Clip to current viewport, to avoid doing work for invisible text
                from = Math.max(vp.from, from);
                to = Math.min(vp.to, to);
                if (from >= to)
                    continue;
                this.getDecorationsFor(from, to, decorations);
                replaced.push(from, to);
            }
            if (decorations.length)
                this.decorations = this.decorations.update(decorations, function (pos) {
                    for (var i = 0; i < replaced.length; i += 2)
                        if (pos >= replaced[i] && pos < replaced[i + 1])
                            return false;
                    return true;
                }, replaced[0], replaced[replaced.length - 1]);
        };
        SpecialCharHighlighter.prototype.updateForViewport = function () {
            var vp = this.view.viewport;
            // Viewports match, don't do anything
            if (this.from == vp.from && this.to == vp.to)
                return;
            var decorations = [];
            if (this.from >= vp.to || this.to <= vp.from) {
                this.getDecorationsFor(vp.from, vp.to, decorations);
                this.decorations = Decoration.set(decorations);
            }
            else {
                if (vp.from < this.from)
                    this.getDecorationsFor(vp.from, this.from, decorations);
                if (this.to < vp.to)
                    this.getDecorationsFor(this.to, vp.to, decorations);
                this.decorations = this.decorations.update(decorations, function (from, to) { return from >= vp.from && to <= vp.to; });
            }
            this.from = vp.from;
            this.to = vp.to;
        };
        SpecialCharHighlighter.prototype.getDecorationsFor = function (from, to, target) {
            var doc = this.view.state.doc;
            for (var pos = from, cursor = doc.iterRange(from, to), m = void 0; !cursor.next().done;) {
                if (!cursor.lineBreak) {
                    while (m = SPECIALS.exec(cursor.value)) {
                        var code = m[0].codePointAt ? m[0].codePointAt(0) : m[0].charCodeAt(0), widget = void 0;
                        if (code == null)
                            continue;
                        if (code == 9) {
                            var line = doc.lineAt(pos + m.index);
                            var size = this.view.state.tabSize, col = countColumn(doc.slice(line.start, pos + m.index), 0, size);
                            widget = new TabWidget((size - (col % size)) * this.view.defaultCharacterWidth);
                        }
                        else {
                            widget = new SpecialCharWidget(this.options, code);
                        }
                        target.push(Decoration.range(pos + m.index, pos + m.index + m[0].length, { collapsed: widget }));
                    }
                }
                pos += cursor.value.length;
            }
        };
        Object.defineProperty(SpecialCharHighlighter.prototype, "styles", {
            get: function () { return style; },
            enumerable: true,
            configurable: true
        });
        return SpecialCharHighlighter;
    }());
    // FIXME configurable
    var SPECIALS = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028\u2029\ufeff]/gu;
    var NAMES = {
        0: "null",
        7: "bell",
        8: "backspace",
        10: "newline",
        11: "vertical tab",
        13: "carriage return",
        27: "escape",
        8203: "zero width space",
        8204: "zero width non-joiner",
        8205: "zero width joiner",
        8206: "left-to-right mark",
        8207: "right-to-left mark",
        8232: "line separator",
        8233: "paragraph separator",
        65279: "zero width no-break space"
    };
    // Assigns placeholder characters from the Control Pictures block to
    // ASCII control characters
    function placeHolder(code) {
        if (code >= 32)
            return null;
        if (code == 10)
            return "\u2424";
        return String.fromCharCode(9216 + code);
    }
    var DEFAULT_PLACEHOLDER = "\u2022";
    var SpecialCharWidget = /** @class */ (function (_super) {
        __extends(SpecialCharWidget, _super);
        function SpecialCharWidget(options, code) {
            var _this = _super.call(this, code) || this;
            _this.options = options;
            return _this;
        }
        SpecialCharWidget.prototype.toDOM = function () {
            var ph = placeHolder(this.value) || DEFAULT_PLACEHOLDER;
            var desc = "Control character " + (NAMES[this.value] || this.value);
            var custom = this.options.render && this.options.render(this.value, desc, ph);
            if (custom)
                return custom;
            var span = document.createElement("span");
            span.textContent = ph;
            span.title = desc;
            span.setAttribute("aria-label", desc);
            span.style.color = "red";
            return span;
        };
        SpecialCharWidget.prototype.ignoreEvent = function () { return false; };
        return SpecialCharWidget;
    }(WidgetType));
    var TabWidget = /** @class */ (function (_super) {
        __extends(TabWidget, _super);
        function TabWidget() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        TabWidget.prototype.toDOM = function () {
            var span = document.createElement("span");
            span.textContent = "\t";
            span.className = style.tab;
            span.style.width = this.value + "px";
            return span;
        };
        TabWidget.prototype.ignoreEvent = function () { return false; };
        return TabWidget;
    }(WidgetType));
    var style = new styleMod_1({
        tab: {
            display: "inline-block",
            overflow: "hidden",
            verticalAlign: "bottom"
        }
    });

    var multipleSelections = StateExtension.unique(function (configs) {
        var rangeConfig = { class: styles$2.secondarySelection }; // FIXME configurable?
        return StateExtension.all(StateExtension.allowMultipleSelections(true), ViewField.decorations({
            create: function (view) { return decorateSelections(view.state, rangeConfig); },
            update: function (deco, _a) {
                var prevState = _a.prevState, state = _a.state;
                return prevState.doc == state.doc && prevState.selection.eq(state.selection)
                    ? deco : decorateSelections(state, rangeConfig);
            },
            map: false
        }), styleModule(styles$2));
    }, {});
    var CursorWidget = /** @class */ (function (_super) {
        __extends(CursorWidget, _super);
        function CursorWidget() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        CursorWidget.prototype.toDOM = function () {
            var span = document.createElement("span");
            span.className = styles$2.secondaryCursor;
            return span;
        };
        return CursorWidget;
    }(WidgetType));
    function decorateSelections(state, rangeConfig) {
        var _a = state.selection, ranges = _a.ranges, primaryIndex = _a.primaryIndex;
        if (ranges.length == 1)
            return Decoration.none;
        var deco = [];
        for (var i = 0; i < ranges.length; i++)
            if (i != primaryIndex) {
                var range = ranges[i];
                deco.push(range.empty ? Decoration.widget(range.from, { widget: new CursorWidget(null) })
                    : Decoration.range(ranges[i].from, ranges[i].to, rangeConfig));
            }
        return Decoration.set(deco);
    }
    var styles$2 = new styleMod_1({
        secondarySelection: {
            backgroundColor_fallback: "#3297FD",
            color_fallback: "white !important",
            backgroundColor: "Highlight",
            color: "HighlightText !important"
        },
        secondaryCursor: {
            display: "inline-block",
            verticalAlign: "text-top",
            borderLeft: "1px solid #555",
            width: 0,
            height: "1.15em",
            margin: "0 -0.5px -.5em"
        }
    });

    var _a$1;
    var mode = legacyMode({ mode: javascript({ indentUnit: 2 }, {}) });
    var isMac = /Mac/.test(navigator.platform);
    var state = EditorState.create({ doc: "\"use strict\";\nconst {readFile} = require(\"fs\");\n\nreadFile(\"package.json\", \"utf8\", (err, data) => {\n  console.log(data);\n});", extensions: [
            gutter(),
            history(),
            specialChars(),
            multipleSelections(),
            mode,
            matchBrackets(),
            keymap((_a$1 = {
                    "Mod-z": undo,
                    "Mod-Shift-z": redo,
                    "Mod-u": function (view) { return undoSelection(view) || true; }
                },
                _a$1[isMac ? "Mod-Shift-u" : "Alt-u"] = redoSelection,
                _a$1["Ctrl-y"] = isMac ? undefined : redo,
                _a$1["Shift-Tab"] = indentSelection,
                _a$1)),
            keymap(baseKeymap),
        ] });
    var view = window.view = new EditorView({ state: state });
    document.querySelector("#editor").appendChild(view.dom);

}));
//# sourceMappingURL=demo_built.js.map
