import { findParentNodeClosestToPos, Node as Node$1, mergeAttributes, callOrReturn, getExtensionField } from '@tiptap/core';
import { CellSelection, addColumnBefore, addColumnAfter, deleteColumn, addRowBefore, addRowAfter, deleteRow, deleteTable, mergeCells, splitCell, toggleHeaderColumn, toggleHeaderRow, toggleHeaderCell, setCellAttr, goToNextCell, fixTables, columnResizing, tableEditing } from 'prosemirror-tables';

function findDiffStart(a, b, pos) {
  for (var i = 0;; i++) {
    if (i == a.childCount || i == b.childCount)
      { return a.childCount == b.childCount ? null : pos }

    var childA = a.child(i), childB = b.child(i);
    if (childA == childB) { pos += childA.nodeSize; continue }

    if (!childA.sameMarkup(childB)) { return pos }

    if (childA.isText && childA.text != childB.text) {
      for (var j = 0; childA.text[j] == childB.text[j]; j++)
        { pos++; }
      return pos
    }
    if (childA.content.size || childB.content.size) {
      var inner = findDiffStart(childA.content, childB.content, pos + 1);
      if (inner != null) { return inner }
    }
    pos += childA.nodeSize;
  }
}

function findDiffEnd(a, b, posA, posB) {
  for (var iA = a.childCount, iB = b.childCount;;) {
    if (iA == 0 || iB == 0)
      { return iA == iB ? null : {a: posA, b: posB} }

    var childA = a.child(--iA), childB = b.child(--iB), size = childA.nodeSize;
    if (childA == childB) {
      posA -= size; posB -= size;
      continue
    }

    if (!childA.sameMarkup(childB)) { return {a: posA, b: posB} }

    if (childA.isText && childA.text != childB.text) {
      var same = 0, minSize = Math.min(childA.text.length, childB.text.length);
      while (same < minSize && childA.text[childA.text.length - same - 1] == childB.text[childB.text.length - same - 1]) {
        same++; posA--; posB--;
      }
      return {a: posA, b: posB}
    }
    if (childA.content.size || childB.content.size) {
      var inner = findDiffEnd(childA.content, childB.content, posA - 1, posB - 1);
      if (inner) { return inner }
    }
    posA -= size; posB -= size;
  }
}

// ::- A fragment represents a node's collection of child nodes.
//
// Like nodes, fragments are persistent data structures, and you
// should not mutate them or their content. Rather, you create new
// instances whenever needed. The API tries to make this easy.
var Fragment = function Fragment(content, size) {
  this.content = content;
  // :: number
  // The size of the fragment, which is the total of the size of its
  // content nodes.
  this.size = size || 0;
  if (size == null) { for (var i = 0; i < content.length; i++)
    { this.size += content[i].nodeSize; } }
};

var prototypeAccessors$3 = { firstChild: { configurable: true },lastChild: { configurable: true },childCount: { configurable: true } };

// :: (number, number, (node: Node, start: number, parent: Node, index: number) → ?bool, ?number)
// Invoke a callback for all descendant nodes between the given two
// positions (relative to start of this fragment). Doesn't descend
// into a node when the callback returns `false`.
Fragment.prototype.nodesBetween = function nodesBetween (from, to, f, nodeStart, parent) {
    if ( nodeStart === void 0 ) nodeStart = 0;

  for (var i = 0, pos = 0; pos < to; i++) {
    var child = this.content[i], end = pos + child.nodeSize;
    if (end > from && f(child, nodeStart + pos, parent, i) !== false && child.content.size) {
      var start = pos + 1;
      child.nodesBetween(Math.max(0, from - start),
                         Math.min(child.content.size, to - start),
                         f, nodeStart + start);
    }
    pos = end;
  }
};

// :: ((node: Node, pos: number, parent: Node) → ?bool)
// Call the given callback for every descendant node. The callback
// may return `false` to prevent traversal of a given node's children.
Fragment.prototype.descendants = function descendants (f) {
  this.nodesBetween(0, this.size, f);
};

// :: (number, number, ?string, ?string) → string
// Extract the text between `from` and `to`. See the same method on
// [`Node`](#model.Node.textBetween).
Fragment.prototype.textBetween = function textBetween (from, to, blockSeparator, leafText) {
  var text = "", separated = true;
  this.nodesBetween(from, to, function (node, pos) {
    if (node.isText) {
      text += node.text.slice(Math.max(from, pos) - pos, to - pos);
      separated = !blockSeparator;
    } else if (node.isLeaf && leafText) {
      text += leafText;
      separated = !blockSeparator;
    } else if (!separated && node.isBlock) {
      text += blockSeparator;
      separated = true;
    }
  }, 0);
  return text
};

// :: (Fragment) → Fragment
// Create a new fragment containing the combined content of this
// fragment and the other.
Fragment.prototype.append = function append (other) {
  if (!other.size) { return this }
  if (!this.size) { return other }
  var last = this.lastChild, first = other.firstChild, content = this.content.slice(), i = 0;
  if (last.isText && last.sameMarkup(first)) {
    content[content.length - 1] = last.withText(last.text + first.text);
    i = 1;
  }
  for (; i < other.content.length; i++) { content.push(other.content[i]); }
  return new Fragment(content, this.size + other.size)
};

// :: (number, ?number) → Fragment
// Cut out the sub-fragment between the two given positions.
Fragment.prototype.cut = function cut (from, to) {
  if (to == null) { to = this.size; }
  if (from == 0 && to == this.size) { return this }
  var result = [], size = 0;
  if (to > from) { for (var i = 0, pos = 0; pos < to; i++) {
    var child = this.content[i], end = pos + child.nodeSize;
    if (end > from) {
      if (pos < from || end > to) {
        if (child.isText)
          { child = child.cut(Math.max(0, from - pos), Math.min(child.text.length, to - pos)); }
        else
          { child = child.cut(Math.max(0, from - pos - 1), Math.min(child.content.size, to - pos - 1)); }
      }
      result.push(child);
      size += child.nodeSize;
    }
    pos = end;
  } }
  return new Fragment(result, size)
};

Fragment.prototype.cutByIndex = function cutByIndex (from, to) {
  if (from == to) { return Fragment.empty }
  if (from == 0 && to == this.content.length) { return this }
  return new Fragment(this.content.slice(from, to))
};

// :: (number, Node) → Fragment
// Create a new fragment in which the node at the given index is
// replaced by the given node.
Fragment.prototype.replaceChild = function replaceChild (index, node) {
  var current = this.content[index];
  if (current == node) { return this }
  var copy = this.content.slice();
  var size = this.size + node.nodeSize - current.nodeSize;
  copy[index] = node;
  return new Fragment(copy, size)
};

// : (Node) → Fragment
// Create a new fragment by prepending the given node to this
// fragment.
Fragment.prototype.addToStart = function addToStart (node) {
  return new Fragment([node].concat(this.content), this.size + node.nodeSize)
};

// : (Node) → Fragment
// Create a new fragment by appending the given node to this
// fragment.
Fragment.prototype.addToEnd = function addToEnd (node) {
  return new Fragment(this.content.concat(node), this.size + node.nodeSize)
};

// :: (Fragment) → bool
// Compare this fragment to another one.
Fragment.prototype.eq = function eq (other) {
  if (this.content.length != other.content.length) { return false }
  for (var i = 0; i < this.content.length; i++)
    { if (!this.content[i].eq(other.content[i])) { return false } }
  return true
};

// :: ?Node
// The first child of the fragment, or `null` if it is empty.
prototypeAccessors$3.firstChild.get = function () { return this.content.length ? this.content[0] : null };

// :: ?Node
// The last child of the fragment, or `null` if it is empty.
prototypeAccessors$3.lastChild.get = function () { return this.content.length ? this.content[this.content.length - 1] : null };

// :: number
// The number of child nodes in this fragment.
prototypeAccessors$3.childCount.get = function () { return this.content.length };

// :: (number) → Node
// Get the child node at the given index. Raise an error when the
// index is out of range.
Fragment.prototype.child = function child (index) {
  var found = this.content[index];
  if (!found) { throw new RangeError("Index " + index + " out of range for " + this) }
  return found
};

// :: (number) → ?Node
// Get the child node at the given index, if it exists.
Fragment.prototype.maybeChild = function maybeChild (index) {
  return this.content[index]
};

// :: ((node: Node, offset: number, index: number))
// Call `f` for every child node, passing the node, its offset
// into this parent node, and its index.
Fragment.prototype.forEach = function forEach (f) {
  for (var i = 0, p = 0; i < this.content.length; i++) {
    var child = this.content[i];
    f(child, p, i);
    p += child.nodeSize;
  }
};

// :: (Fragment) → ?number
// Find the first position at which this fragment and another
// fragment differ, or `null` if they are the same.
Fragment.prototype.findDiffStart = function findDiffStart$1 (other, pos) {
    if ( pos === void 0 ) pos = 0;

  return findDiffStart(this, other, pos)
};

// :: (Fragment) → ?{a: number, b: number}
// Find the first position, searching from the end, at which this
// fragment and the given fragment differ, or `null` if they are the
// same. Since this position will not be the same in both nodes, an
// object with two separate positions is returned.
Fragment.prototype.findDiffEnd = function findDiffEnd$1 (other, pos, otherPos) {
    if ( pos === void 0 ) pos = this.size;
    if ( otherPos === void 0 ) otherPos = other.size;

  return findDiffEnd(this, other, pos, otherPos)
};

// : (number, ?number) → {index: number, offset: number}
// Find the index and inner offset corresponding to a given relative
// position in this fragment. The result object will be reused
// (overwritten) the next time the function is called. (Not public.)
Fragment.prototype.findIndex = function findIndex (pos, round) {
    if ( round === void 0 ) round = -1;

  if (pos == 0) { return retIndex(0, pos) }
  if (pos == this.size) { return retIndex(this.content.length, pos) }
  if (pos > this.size || pos < 0) { throw new RangeError(("Position " + pos + " outside of fragment (" + (this) + ")")) }
  for (var i = 0, curPos = 0;; i++) {
    var cur = this.child(i), end = curPos + cur.nodeSize;
    if (end >= pos) {
      if (end == pos || round > 0) { return retIndex(i + 1, end) }
      return retIndex(i, curPos)
    }
    curPos = end;
  }
};

// :: () → string
// Return a debugging string that describes this fragment.
Fragment.prototype.toString = function toString () { return "<" + this.toStringInner() + ">" };

Fragment.prototype.toStringInner = function toStringInner () { return this.content.join(", ") };

// :: () → ?Object
// Create a JSON-serializeable representation of this fragment.
Fragment.prototype.toJSON = function toJSON () {
  return this.content.length ? this.content.map(function (n) { return n.toJSON(); }) : null
};

// :: (Schema, ?Object) → Fragment
// Deserialize a fragment from its JSON representation.
Fragment.fromJSON = function fromJSON (schema, value) {
  if (!value) { return Fragment.empty }
  if (!Array.isArray(value)) { throw new RangeError("Invalid input for Fragment.fromJSON") }
  return new Fragment(value.map(schema.nodeFromJSON))
};

// :: ([Node]) → Fragment
// Build a fragment from an array of nodes. Ensures that adjacent
// text nodes with the same marks are joined together.
Fragment.fromArray = function fromArray (array) {
  if (!array.length) { return Fragment.empty }
  var joined, size = 0;
  for (var i = 0; i < array.length; i++) {
    var node = array[i];
    size += node.nodeSize;
    if (i && node.isText && array[i - 1].sameMarkup(node)) {
      if (!joined) { joined = array.slice(0, i); }
      joined[joined.length - 1] = node.withText(joined[joined.length - 1].text + node.text);
    } else if (joined) {
      joined.push(node);
    }
  }
  return new Fragment(joined || array, size)
};

// :: (?union<Fragment, Node, [Node]>) → Fragment
// Create a fragment from something that can be interpreted as a set
// of nodes. For `null`, it returns the empty fragment. For a
// fragment, the fragment itself. For a node or array of nodes, a
// fragment containing those nodes.
Fragment.from = function from (nodes) {
  if (!nodes) { return Fragment.empty }
  if (nodes instanceof Fragment) { return nodes }
  if (Array.isArray(nodes)) { return this.fromArray(nodes) }
  if (nodes.attrs) { return new Fragment([nodes], nodes.nodeSize) }
  throw new RangeError("Can not convert " + nodes + " to a Fragment" +
                       (nodes.nodesBetween ? " (looks like multiple versions of prosemirror-model were loaded)" : ""))
};

Object.defineProperties( Fragment.prototype, prototypeAccessors$3 );

var found = {index: 0, offset: 0};
function retIndex(index, offset) {
  found.index = index;
  found.offset = offset;
  return found
}

// :: Fragment
// An empty fragment. Intended to be reused whenever a node doesn't
// contain anything (rather than allocating a new empty fragment for
// each leaf node).
Fragment.empty = new Fragment([], 0);

function compareDeep(a, b) {
  if (a === b) { return true }
  if (!(a && typeof a == "object") ||
      !(b && typeof b == "object")) { return false }
  var array = Array.isArray(a);
  if (Array.isArray(b) != array) { return false }
  if (array) {
    if (a.length != b.length) { return false }
    for (var i = 0; i < a.length; i++) { if (!compareDeep(a[i], b[i])) { return false } }
  } else {
    for (var p in a) { if (!(p in b) || !compareDeep(a[p], b[p])) { return false } }
    for (var p$1 in b) { if (!(p$1 in a)) { return false } }
  }
  return true
}

// ::- A mark is a piece of information that can be attached to a node,
// such as it being emphasized, in code font, or a link. It has a type
// and optionally a set of attributes that provide further information
// (such as the target of the link). Marks are created through a
// `Schema`, which controls which types exist and which
// attributes they have.
var Mark = function Mark(type, attrs) {
  // :: MarkType
  // The type of this mark.
  this.type = type;
  // :: Object
  // The attributes associated with this mark.
  this.attrs = attrs;
};

// :: ([Mark]) → [Mark]
// Given a set of marks, create a new set which contains this one as
// well, in the right position. If this mark is already in the set,
// the set itself is returned. If any marks that are set to be
// [exclusive](#model.MarkSpec.excludes) with this mark are present,
// those are replaced by this one.
Mark.prototype.addToSet = function addToSet (set) {
  var copy, placed = false;
  for (var i = 0; i < set.length; i++) {
    var other = set[i];
    if (this.eq(other)) { return set }
    if (this.type.excludes(other.type)) {
      if (!copy) { copy = set.slice(0, i); }
    } else if (other.type.excludes(this.type)) {
      return set
    } else {
      if (!placed && other.type.rank > this.type.rank) {
        if (!copy) { copy = set.slice(0, i); }
        copy.push(this);
        placed = true;
      }
      if (copy) { copy.push(other); }
    }
  }
  if (!copy) { copy = set.slice(); }
  if (!placed) { copy.push(this); }
  return copy
};

// :: ([Mark]) → [Mark]
// Remove this mark from the given set, returning a new set. If this
// mark is not in the set, the set itself is returned.
Mark.prototype.removeFromSet = function removeFromSet (set) {
  for (var i = 0; i < set.length; i++)
    { if (this.eq(set[i]))
      { return set.slice(0, i).concat(set.slice(i + 1)) } }
  return set
};

// :: ([Mark]) → bool
// Test whether this mark is in the given set of marks.
Mark.prototype.isInSet = function isInSet (set) {
  for (var i = 0; i < set.length; i++)
    { if (this.eq(set[i])) { return true } }
  return false
};

// :: (Mark) → bool
// Test whether this mark has the same type and attributes as
// another mark.
Mark.prototype.eq = function eq (other) {
  return this == other ||
    (this.type == other.type && compareDeep(this.attrs, other.attrs))
};

// :: () → Object
// Convert this mark to a JSON-serializeable representation.
Mark.prototype.toJSON = function toJSON () {
  var obj = {type: this.type.name};
  for (var _ in this.attrs) {
    obj.attrs = this.attrs;
    break
  }
  return obj
};

// :: (Schema, Object) → Mark
Mark.fromJSON = function fromJSON (schema, json) {
  if (!json) { throw new RangeError("Invalid input for Mark.fromJSON") }
  var type = schema.marks[json.type];
  if (!type) { throw new RangeError(("There is no mark type " + (json.type) + " in this schema")) }
  return type.create(json.attrs)
};

// :: ([Mark], [Mark]) → bool
// Test whether two sets of marks are identical.
Mark.sameSet = function sameSet (a, b) {
  if (a == b) { return true }
  if (a.length != b.length) { return false }
  for (var i = 0; i < a.length; i++)
    { if (!a[i].eq(b[i])) { return false } }
  return true
};

// :: (?union<Mark, [Mark]>) → [Mark]
// Create a properly sorted mark set from null, a single mark, or an
// unsorted array of marks.
Mark.setFrom = function setFrom (marks) {
  if (!marks || marks.length == 0) { return Mark.none }
  if (marks instanceof Mark) { return [marks] }
  var copy = marks.slice();
  copy.sort(function (a, b) { return a.type.rank - b.type.rank; });
  return copy
};

// :: [Mark] The empty set of marks.
Mark.none = [];

// ReplaceError:: class extends Error
// Error type raised by [`Node.replace`](#model.Node.replace) when
// given an invalid replacement.

function ReplaceError(message) {
  var err = Error.call(this, message);
  err.__proto__ = ReplaceError.prototype;
  return err
}

ReplaceError.prototype = Object.create(Error.prototype);
ReplaceError.prototype.constructor = ReplaceError;
ReplaceError.prototype.name = "ReplaceError";

// ::- A slice represents a piece cut out of a larger document. It
// stores not only a fragment, but also the depth up to which nodes on
// both side are ‘open’ (cut through).
var Slice = function Slice(content, openStart, openEnd) {
  // :: Fragment The slice's content.
  this.content = content;
  // :: number The open depth at the start.
  this.openStart = openStart;
  // :: number The open depth at the end.
  this.openEnd = openEnd;
};

var prototypeAccessors$1$2 = { size: { configurable: true } };

// :: number
// The size this slice would add when inserted into a document.
prototypeAccessors$1$2.size.get = function () {
  return this.content.size - this.openStart - this.openEnd
};

Slice.prototype.insertAt = function insertAt (pos, fragment) {
  var content = insertInto(this.content, pos + this.openStart, fragment, null);
  return content && new Slice(content, this.openStart, this.openEnd)
};

Slice.prototype.removeBetween = function removeBetween (from, to) {
  return new Slice(removeRange(this.content, from + this.openStart, to + this.openStart), this.openStart, this.openEnd)
};

// :: (Slice) → bool
// Tests whether this slice is equal to another slice.
Slice.prototype.eq = function eq (other) {
  return this.content.eq(other.content) && this.openStart == other.openStart && this.openEnd == other.openEnd
};

Slice.prototype.toString = function toString () {
  return this.content + "(" + this.openStart + "," + this.openEnd + ")"
};

// :: () → ?Object
// Convert a slice to a JSON-serializable representation.
Slice.prototype.toJSON = function toJSON () {
  if (!this.content.size) { return null }
  var json = {content: this.content.toJSON()};
  if (this.openStart > 0) { json.openStart = this.openStart; }
  if (this.openEnd > 0) { json.openEnd = this.openEnd; }
  return json
};

// :: (Schema, ?Object) → Slice
// Deserialize a slice from its JSON representation.
Slice.fromJSON = function fromJSON (schema, json) {
  if (!json) { return Slice.empty }
  var openStart = json.openStart || 0, openEnd = json.openEnd || 0;
  if (typeof openStart != "number" || typeof openEnd != "number")
    { throw new RangeError("Invalid input for Slice.fromJSON") }
  return new Slice(Fragment.fromJSON(schema, json.content), openStart, openEnd)
};

// :: (Fragment, ?bool) → Slice
// Create a slice from a fragment by taking the maximum possible
// open value on both side of the fragment.
Slice.maxOpen = function maxOpen (fragment, openIsolating) {
    if ( openIsolating === void 0 ) openIsolating=true;

  var openStart = 0, openEnd = 0;
  for (var n = fragment.firstChild; n && !n.isLeaf && (openIsolating || !n.type.spec.isolating); n = n.firstChild) { openStart++; }
  for (var n$1 = fragment.lastChild; n$1 && !n$1.isLeaf && (openIsolating || !n$1.type.spec.isolating); n$1 = n$1.lastChild) { openEnd++; }
  return new Slice(fragment, openStart, openEnd)
};

Object.defineProperties( Slice.prototype, prototypeAccessors$1$2 );

function removeRange(content, from, to) {
  var ref = content.findIndex(from);
  var index = ref.index;
  var offset = ref.offset;
  var child = content.maybeChild(index);
  var ref$1 = content.findIndex(to);
  var indexTo = ref$1.index;
  var offsetTo = ref$1.offset;
  if (offset == from || child.isText) {
    if (offsetTo != to && !content.child(indexTo).isText) { throw new RangeError("Removing non-flat range") }
    return content.cut(0, from).append(content.cut(to))
  }
  if (index != indexTo) { throw new RangeError("Removing non-flat range") }
  return content.replaceChild(index, child.copy(removeRange(child.content, from - offset - 1, to - offset - 1)))
}

function insertInto(content, dist, insert, parent) {
  var ref = content.findIndex(dist);
  var index = ref.index;
  var offset = ref.offset;
  var child = content.maybeChild(index);
  if (offset == dist || child.isText) {
    if (parent && !parent.canReplace(index, index, insert)) { return null }
    return content.cut(0, dist).append(insert).append(content.cut(dist))
  }
  var inner = insertInto(child.content, dist - offset - 1, insert);
  return inner && content.replaceChild(index, child.copy(inner))
}

// :: Slice
// The empty slice.
Slice.empty = new Slice(Fragment.empty, 0, 0);

function replace($from, $to, slice) {
  if (slice.openStart > $from.depth)
    { throw new ReplaceError("Inserted content deeper than insertion position") }
  if ($from.depth - slice.openStart != $to.depth - slice.openEnd)
    { throw new ReplaceError("Inconsistent open depths") }
  return replaceOuter($from, $to, slice, 0)
}

function replaceOuter($from, $to, slice, depth) {
  var index = $from.index(depth), node = $from.node(depth);
  if (index == $to.index(depth) && depth < $from.depth - slice.openStart) {
    var inner = replaceOuter($from, $to, slice, depth + 1);
    return node.copy(node.content.replaceChild(index, inner))
  } else if (!slice.content.size) {
    return close(node, replaceTwoWay($from, $to, depth))
  } else if (!slice.openStart && !slice.openEnd && $from.depth == depth && $to.depth == depth) { // Simple, flat case
    var parent = $from.parent, content = parent.content;
    return close(parent, content.cut(0, $from.parentOffset).append(slice.content).append(content.cut($to.parentOffset)))
  } else {
    var ref = prepareSliceForReplace(slice, $from);
    var start = ref.start;
    var end = ref.end;
    return close(node, replaceThreeWay($from, start, end, $to, depth))
  }
}

function checkJoin(main, sub) {
  if (!sub.type.compatibleContent(main.type))
    { throw new ReplaceError("Cannot join " + sub.type.name + " onto " + main.type.name) }
}

function joinable($before, $after, depth) {
  var node = $before.node(depth);
  checkJoin(node, $after.node(depth));
  return node
}

function addNode(child, target) {
  var last = target.length - 1;
  if (last >= 0 && child.isText && child.sameMarkup(target[last]))
    { target[last] = child.withText(target[last].text + child.text); }
  else
    { target.push(child); }
}

function addRange($start, $end, depth, target) {
  var node = ($end || $start).node(depth);
  var startIndex = 0, endIndex = $end ? $end.index(depth) : node.childCount;
  if ($start) {
    startIndex = $start.index(depth);
    if ($start.depth > depth) {
      startIndex++;
    } else if ($start.textOffset) {
      addNode($start.nodeAfter, target);
      startIndex++;
    }
  }
  for (var i = startIndex; i < endIndex; i++) { addNode(node.child(i), target); }
  if ($end && $end.depth == depth && $end.textOffset)
    { addNode($end.nodeBefore, target); }
}

function close(node, content) {
  if (!node.type.validContent(content))
    { throw new ReplaceError("Invalid content for node " + node.type.name) }
  return node.copy(content)
}

function replaceThreeWay($from, $start, $end, $to, depth) {
  var openStart = $from.depth > depth && joinable($from, $start, depth + 1);
  var openEnd = $to.depth > depth && joinable($end, $to, depth + 1);

  var content = [];
  addRange(null, $from, depth, content);
  if (openStart && openEnd && $start.index(depth) == $end.index(depth)) {
    checkJoin(openStart, openEnd);
    addNode(close(openStart, replaceThreeWay($from, $start, $end, $to, depth + 1)), content);
  } else {
    if (openStart)
      { addNode(close(openStart, replaceTwoWay($from, $start, depth + 1)), content); }
    addRange($start, $end, depth, content);
    if (openEnd)
      { addNode(close(openEnd, replaceTwoWay($end, $to, depth + 1)), content); }
  }
  addRange($to, null, depth, content);
  return new Fragment(content)
}

function replaceTwoWay($from, $to, depth) {
  var content = [];
  addRange(null, $from, depth, content);
  if ($from.depth > depth) {
    var type = joinable($from, $to, depth + 1);
    addNode(close(type, replaceTwoWay($from, $to, depth + 1)), content);
  }
  addRange($to, null, depth, content);
  return new Fragment(content)
}

function prepareSliceForReplace(slice, $along) {
  var extra = $along.depth - slice.openStart, parent = $along.node(extra);
  var node = parent.copy(slice.content);
  for (var i = extra - 1; i >= 0; i--)
    { node = $along.node(i).copy(Fragment.from(node)); }
  return {start: node.resolveNoCache(slice.openStart + extra),
          end: node.resolveNoCache(node.content.size - slice.openEnd - extra)}
}

// ::- You can [_resolve_](#model.Node.resolve) a position to get more
// information about it. Objects of this class represent such a
// resolved position, providing various pieces of context information,
// and some helper methods.
//
// Throughout this interface, methods that take an optional `depth`
// parameter will interpret undefined as `this.depth` and negative
// numbers as `this.depth + value`.
var ResolvedPos = function ResolvedPos(pos, path, parentOffset) {
  // :: number The position that was resolved.
  this.pos = pos;
  this.path = path;
  // :: number
  // The number of levels the parent node is from the root. If this
  // position points directly into the root node, it is 0. If it
  // points into a top-level paragraph, 1, and so on.
  this.depth = path.length / 3 - 1;
  // :: number The offset this position has into its parent node.
  this.parentOffset = parentOffset;
};

var prototypeAccessors$2$1 = { parent: { configurable: true },doc: { configurable: true },textOffset: { configurable: true },nodeAfter: { configurable: true },nodeBefore: { configurable: true } };

ResolvedPos.prototype.resolveDepth = function resolveDepth (val) {
  if (val == null) { return this.depth }
  if (val < 0) { return this.depth + val }
  return val
};

// :: Node
// The parent node that the position points into. Note that even if
// a position points into a text node, that node is not considered
// the parent—text nodes are ‘flat’ in this model, and have no content.
prototypeAccessors$2$1.parent.get = function () { return this.node(this.depth) };

// :: Node
// The root node in which the position was resolved.
prototypeAccessors$2$1.doc.get = function () { return this.node(0) };

// :: (?number) → Node
// The ancestor node at the given level. `p.node(p.depth)` is the
// same as `p.parent`.
ResolvedPos.prototype.node = function node (depth) { return this.path[this.resolveDepth(depth) * 3] };

// :: (?number) → number
// The index into the ancestor at the given level. If this points at
// the 3rd node in the 2nd paragraph on the top level, for example,
// `p.index(0)` is 1 and `p.index(1)` is 2.
ResolvedPos.prototype.index = function index (depth) { return this.path[this.resolveDepth(depth) * 3 + 1] };

// :: (?number) → number
// The index pointing after this position into the ancestor at the
// given level.
ResolvedPos.prototype.indexAfter = function indexAfter (depth) {
  depth = this.resolveDepth(depth);
  return this.index(depth) + (depth == this.depth && !this.textOffset ? 0 : 1)
};

// :: (?number) → number
// The (absolute) position at the start of the node at the given
// level.
ResolvedPos.prototype.start = function start (depth) {
  depth = this.resolveDepth(depth);
  return depth == 0 ? 0 : this.path[depth * 3 - 1] + 1
};

// :: (?number) → number
// The (absolute) position at the end of the node at the given
// level.
ResolvedPos.prototype.end = function end (depth) {
  depth = this.resolveDepth(depth);
  return this.start(depth) + this.node(depth).content.size
};

// :: (?number) → number
// The (absolute) position directly before the wrapping node at the
// given level, or, when `depth` is `this.depth + 1`, the original
// position.
ResolvedPos.prototype.before = function before (depth) {
  depth = this.resolveDepth(depth);
  if (!depth) { throw new RangeError("There is no position before the top-level node") }
  return depth == this.depth + 1 ? this.pos : this.path[depth * 3 - 1]
};

// :: (?number) → number
// The (absolute) position directly after the wrapping node at the
// given level, or the original position when `depth` is `this.depth + 1`.
ResolvedPos.prototype.after = function after (depth) {
  depth = this.resolveDepth(depth);
  if (!depth) { throw new RangeError("There is no position after the top-level node") }
  return depth == this.depth + 1 ? this.pos : this.path[depth * 3 - 1] + this.path[depth * 3].nodeSize
};

// :: number
// When this position points into a text node, this returns the
// distance between the position and the start of the text node.
// Will be zero for positions that point between nodes.
prototypeAccessors$2$1.textOffset.get = function () { return this.pos - this.path[this.path.length - 1] };

// :: ?Node
// Get the node directly after the position, if any. If the position
// points into a text node, only the part of that node after the
// position is returned.
prototypeAccessors$2$1.nodeAfter.get = function () {
  var parent = this.parent, index = this.index(this.depth);
  if (index == parent.childCount) { return null }
  var dOff = this.pos - this.path[this.path.length - 1], child = parent.child(index);
  return dOff ? parent.child(index).cut(dOff) : child
};

// :: ?Node
// Get the node directly before the position, if any. If the
// position points into a text node, only the part of that node
// before the position is returned.
prototypeAccessors$2$1.nodeBefore.get = function () {
  var index = this.index(this.depth);
  var dOff = this.pos - this.path[this.path.length - 1];
  if (dOff) { return this.parent.child(index).cut(0, dOff) }
  return index == 0 ? null : this.parent.child(index - 1)
};

// :: (number, ?number) → number
// Get the position at the given index in the parent node at the
// given depth (which defaults to `this.depth`).
ResolvedPos.prototype.posAtIndex = function posAtIndex (index, depth) {
  depth = this.resolveDepth(depth);
  var node = this.path[depth * 3], pos = depth == 0 ? 0 : this.path[depth * 3 - 1] + 1;
  for (var i = 0; i < index; i++) { pos += node.child(i).nodeSize; }
  return pos
};

// :: () → [Mark]
// Get the marks at this position, factoring in the surrounding
// marks' [`inclusive`](#model.MarkSpec.inclusive) property. If the
// position is at the start of a non-empty node, the marks of the
// node after it (if any) are returned.
ResolvedPos.prototype.marks = function marks () {
  var parent = this.parent, index = this.index();

  // In an empty parent, return the empty array
  if (parent.content.size == 0) { return Mark.none }

  // When inside a text node, just return the text node's marks
  if (this.textOffset) { return parent.child(index).marks }

  var main = parent.maybeChild(index - 1), other = parent.maybeChild(index);
  // If the `after` flag is true of there is no node before, make
  // the node after this position the main reference.
  if (!main) { var tmp = main; main = other; other = tmp; }

  // Use all marks in the main node, except those that have
  // `inclusive` set to false and are not present in the other node.
  var marks = main.marks;
  for (var i = 0; i < marks.length; i++)
    { if (marks[i].type.spec.inclusive === false && (!other || !marks[i].isInSet(other.marks)))
      { marks = marks[i--].removeFromSet(marks); } }

  return marks
};

// :: (ResolvedPos) → ?[Mark]
// Get the marks after the current position, if any, except those
// that are non-inclusive and not present at position `$end`. This
// is mostly useful for getting the set of marks to preserve after a
// deletion. Will return `null` if this position is at the end of
// its parent node or its parent node isn't a textblock (in which
// case no marks should be preserved).
ResolvedPos.prototype.marksAcross = function marksAcross ($end) {
  var after = this.parent.maybeChild(this.index());
  if (!after || !after.isInline) { return null }

  var marks = after.marks, next = $end.parent.maybeChild($end.index());
  for (var i = 0; i < marks.length; i++)
    { if (marks[i].type.spec.inclusive === false && (!next || !marks[i].isInSet(next.marks)))
      { marks = marks[i--].removeFromSet(marks); } }
  return marks
};

// :: (number) → number
// The depth up to which this position and the given (non-resolved)
// position share the same parent nodes.
ResolvedPos.prototype.sharedDepth = function sharedDepth (pos) {
  for (var depth = this.depth; depth > 0; depth--)
    { if (this.start(depth) <= pos && this.end(depth) >= pos) { return depth } }
  return 0
};

// :: (?ResolvedPos, ?(Node) → bool) → ?NodeRange
// Returns a range based on the place where this position and the
// given position diverge around block content. If both point into
// the same textblock, for example, a range around that textblock
// will be returned. If they point into different blocks, the range
// around those blocks in their shared ancestor is returned. You can
// pass in an optional predicate that will be called with a parent
// node to see if a range into that parent is acceptable.
ResolvedPos.prototype.blockRange = function blockRange (other, pred) {
    if ( other === void 0 ) other = this;

  if (other.pos < this.pos) { return other.blockRange(this) }
  for (var d = this.depth - (this.parent.inlineContent || this.pos == other.pos ? 1 : 0); d >= 0; d--)
    { if (other.pos <= this.end(d) && (!pred || pred(this.node(d))))
      { return new NodeRange(this, other, d) } }
};

// :: (ResolvedPos) → bool
// Query whether the given position shares the same parent node.
ResolvedPos.prototype.sameParent = function sameParent (other) {
  return this.pos - this.parentOffset == other.pos - other.parentOffset
};

// :: (ResolvedPos) → ResolvedPos
// Return the greater of this and the given position.
ResolvedPos.prototype.max = function max (other) {
  return other.pos > this.pos ? other : this
};

// :: (ResolvedPos) → ResolvedPos
// Return the smaller of this and the given position.
ResolvedPos.prototype.min = function min (other) {
  return other.pos < this.pos ? other : this
};

ResolvedPos.prototype.toString = function toString () {
  var str = "";
  for (var i = 1; i <= this.depth; i++)
    { str += (str ? "/" : "") + this.node(i).type.name + "_" + this.index(i - 1); }
  return str + ":" + this.parentOffset
};

ResolvedPos.resolve = function resolve (doc, pos) {
  if (!(pos >= 0 && pos <= doc.content.size)) { throw new RangeError("Position " + pos + " out of range") }
  var path = [];
  var start = 0, parentOffset = pos;
  for (var node = doc;;) {
    var ref = node.content.findIndex(parentOffset);
      var index = ref.index;
      var offset = ref.offset;
    var rem = parentOffset - offset;
    path.push(node, index, start + offset);
    if (!rem) { break }
    node = node.child(index);
    if (node.isText) { break }
    parentOffset = rem - 1;
    start += offset + 1;
  }
  return new ResolvedPos(pos, path, parentOffset)
};

ResolvedPos.resolveCached = function resolveCached (doc, pos) {
  for (var i = 0; i < resolveCache.length; i++) {
    var cached = resolveCache[i];
    if (cached.pos == pos && cached.doc == doc) { return cached }
  }
  var result = resolveCache[resolveCachePos] = ResolvedPos.resolve(doc, pos);
  resolveCachePos = (resolveCachePos + 1) % resolveCacheSize;
  return result
};

Object.defineProperties( ResolvedPos.prototype, prototypeAccessors$2$1 );

var resolveCache = [], resolveCachePos = 0, resolveCacheSize = 12;

// ::- Represents a flat range of content, i.e. one that starts and
// ends in the same node.
var NodeRange = function NodeRange($from, $to, depth) {
  // :: ResolvedPos A resolved position along the start of the
  // content. May have a `depth` greater than this object's `depth`
  // property, since these are the positions that were used to
  // compute the range, not re-resolved positions directly at its
  // boundaries.
  this.$from = $from;
  // :: ResolvedPos A position along the end of the content. See
  // caveat for [`$from`](#model.NodeRange.$from).
  this.$to = $to;
  // :: number The depth of the node that this range points into.
  this.depth = depth;
};

var prototypeAccessors$1$1$1 = { start: { configurable: true },end: { configurable: true },parent: { configurable: true },startIndex: { configurable: true },endIndex: { configurable: true } };

// :: number The position at the start of the range.
prototypeAccessors$1$1$1.start.get = function () { return this.$from.before(this.depth + 1) };
// :: number The position at the end of the range.
prototypeAccessors$1$1$1.end.get = function () { return this.$to.after(this.depth + 1) };

// :: Node The parent node that the range points into.
prototypeAccessors$1$1$1.parent.get = function () { return this.$from.node(this.depth) };
// :: number The start index of the range in the parent node.
prototypeAccessors$1$1$1.startIndex.get = function () { return this.$from.index(this.depth) };
// :: number The end index of the range in the parent node.
prototypeAccessors$1$1$1.endIndex.get = function () { return this.$to.indexAfter(this.depth) };

Object.defineProperties( NodeRange.prototype, prototypeAccessors$1$1$1 );

var emptyAttrs = Object.create(null);

// ::- This class represents a node in the tree that makes up a
// ProseMirror document. So a document is an instance of `Node`, with
// children that are also instances of `Node`.
//
// Nodes are persistent data structures. Instead of changing them, you
// create new ones with the content you want. Old ones keep pointing
// at the old document shape. This is made cheaper by sharing
// structure between the old and new data as much as possible, which a
// tree shape like this (without back pointers) makes easy.
//
// **Do not** directly mutate the properties of a `Node` object. See
// [the guide](/docs/guide/#doc) for more information.
var Node = function Node(type, attrs, content, marks) {
  // :: NodeType
  // The type of node that this is.
  this.type = type;

  // :: Object
  // An object mapping attribute names to values. The kind of
  // attributes allowed and required are
  // [determined](#model.NodeSpec.attrs) by the node type.
  this.attrs = attrs;

  // :: Fragment
  // A container holding the node's children.
  this.content = content || Fragment.empty;

  // :: [Mark]
  // The marks (things like whether it is emphasized or part of a
  // link) applied to this node.
  this.marks = marks || Mark.none;
};

var prototypeAccessors$3$1 = { nodeSize: { configurable: true },childCount: { configurable: true },textContent: { configurable: true },firstChild: { configurable: true },lastChild: { configurable: true },isBlock: { configurable: true },isTextblock: { configurable: true },inlineContent: { configurable: true },isInline: { configurable: true },isText: { configurable: true },isLeaf: { configurable: true },isAtom: { configurable: true } };

// text:: ?string
// For text nodes, this contains the node's text content.

// :: number
// The size of this node, as defined by the integer-based [indexing
// scheme](/docs/guide/#doc.indexing). For text nodes, this is the
// amount of characters. For other leaf nodes, it is one. For
// non-leaf nodes, it is the size of the content plus two (the start
// and end token).
prototypeAccessors$3$1.nodeSize.get = function () { return this.isLeaf ? 1 : 2 + this.content.size };

// :: number
// The number of children that the node has.
prototypeAccessors$3$1.childCount.get = function () { return this.content.childCount };

// :: (number) → Node
// Get the child node at the given index. Raises an error when the
// index is out of range.
Node.prototype.child = function child (index) { return this.content.child(index) };

// :: (number) → ?Node
// Get the child node at the given index, if it exists.
Node.prototype.maybeChild = function maybeChild (index) { return this.content.maybeChild(index) };

// :: ((node: Node, offset: number, index: number))
// Call `f` for every child node, passing the node, its offset
// into this parent node, and its index.
Node.prototype.forEach = function forEach (f) { this.content.forEach(f); };

// :: (number, number, (node: Node, pos: number, parent: Node, index: number) → ?bool, ?number)
// Invoke a callback for all descendant nodes recursively between
// the given two positions that are relative to start of this node's
// content. The callback is invoked with the node, its
// parent-relative position, its parent node, and its child index.
// When the callback returns false for a given node, that node's
// children will not be recursed over. The last parameter can be
// used to specify a starting position to count from.
Node.prototype.nodesBetween = function nodesBetween (from, to, f, startPos) {
    if ( startPos === void 0 ) startPos = 0;

  this.content.nodesBetween(from, to, f, startPos, this);
};

// :: ((node: Node, pos: number, parent: Node) → ?bool)
// Call the given callback for every descendant node. Doesn't
// descend into a node when the callback returns `false`.
Node.prototype.descendants = function descendants (f) {
  this.nodesBetween(0, this.content.size, f);
};

// :: string
// Concatenates all the text nodes found in this fragment and its
// children.
prototypeAccessors$3$1.textContent.get = function () { return this.textBetween(0, this.content.size, "") };

// :: (number, number, ?string, ?string) → string
// Get all text between positions `from` and `to`. When
// `blockSeparator` is given, it will be inserted whenever a new
// block node is started. When `leafText` is given, it'll be
// inserted for every non-text leaf node encountered.
Node.prototype.textBetween = function textBetween (from, to, blockSeparator, leafText) {
  return this.content.textBetween(from, to, blockSeparator, leafText)
};

// :: ?Node
// Returns this node's first child, or `null` if there are no
// children.
prototypeAccessors$3$1.firstChild.get = function () { return this.content.firstChild };

// :: ?Node
// Returns this node's last child, or `null` if there are no
// children.
prototypeAccessors$3$1.lastChild.get = function () { return this.content.lastChild };

// :: (Node) → bool
// Test whether two nodes represent the same piece of document.
Node.prototype.eq = function eq (other) {
  return this == other || (this.sameMarkup(other) && this.content.eq(other.content))
};

// :: (Node) → bool
// Compare the markup (type, attributes, and marks) of this node to
// those of another. Returns `true` if both have the same markup.
Node.prototype.sameMarkup = function sameMarkup (other) {
  return this.hasMarkup(other.type, other.attrs, other.marks)
};

// :: (NodeType, ?Object, ?[Mark]) → bool
// Check whether this node's markup correspond to the given type,
// attributes, and marks.
Node.prototype.hasMarkup = function hasMarkup (type, attrs, marks) {
  return this.type == type &&
    compareDeep(this.attrs, attrs || type.defaultAttrs || emptyAttrs) &&
    Mark.sameSet(this.marks, marks || Mark.none)
};

// :: (?Fragment) → Node
// Create a new node with the same markup as this node, containing
// the given content (or empty, if no content is given).
Node.prototype.copy = function copy (content) {
    if ( content === void 0 ) content = null;

  if (content == this.content) { return this }
  return new this.constructor(this.type, this.attrs, content, this.marks)
};

// :: ([Mark]) → Node
// Create a copy of this node, with the given set of marks instead
// of the node's own marks.
Node.prototype.mark = function mark (marks) {
  return marks == this.marks ? this : new this.constructor(this.type, this.attrs, this.content, marks)
};

// :: (number, ?number) → Node
// Create a copy of this node with only the content between the
// given positions. If `to` is not given, it defaults to the end of
// the node.
Node.prototype.cut = function cut (from, to) {
  if (from == 0 && to == this.content.size) { return this }
  return this.copy(this.content.cut(from, to))
};

// :: (number, ?number) → Slice
// Cut out the part of the document between the given positions, and
// return it as a `Slice` object.
Node.prototype.slice = function slice (from, to, includeParents) {
    if ( to === void 0 ) to = this.content.size;
    if ( includeParents === void 0 ) includeParents = false;

  if (from == to) { return Slice.empty }

  var $from = this.resolve(from), $to = this.resolve(to);
  var depth = includeParents ? 0 : $from.sharedDepth(to);
  var start = $from.start(depth), node = $from.node(depth);
  var content = node.content.cut($from.pos - start, $to.pos - start);
  return new Slice(content, $from.depth - depth, $to.depth - depth)
};

// :: (number, number, Slice) → Node
// Replace the part of the document between the given positions with
// the given slice. The slice must 'fit', meaning its open sides
// must be able to connect to the surrounding content, and its
// content nodes must be valid children for the node they are placed
// into. If any of this is violated, an error of type
// [`ReplaceError`](#model.ReplaceError) is thrown.
Node.prototype.replace = function replace$1 (from, to, slice) {
  return replace(this.resolve(from), this.resolve(to), slice)
};

// :: (number) → ?Node
// Find the node directly after the given position.
Node.prototype.nodeAt = function nodeAt (pos) {
  for (var node = this;;) {
    var ref = node.content.findIndex(pos);
      var index = ref.index;
      var offset = ref.offset;
    node = node.maybeChild(index);
    if (!node) { return null }
    if (offset == pos || node.isText) { return node }
    pos -= offset + 1;
  }
};

// :: (number) → {node: ?Node, index: number, offset: number}
// Find the (direct) child node after the given offset, if any,
// and return it along with its index and offset relative to this
// node.
Node.prototype.childAfter = function childAfter (pos) {
  var ref = this.content.findIndex(pos);
    var index = ref.index;
    var offset = ref.offset;
  return {node: this.content.maybeChild(index), index: index, offset: offset}
};

// :: (number) → {node: ?Node, index: number, offset: number}
// Find the (direct) child node before the given offset, if any,
// and return it along with its index and offset relative to this
// node.
Node.prototype.childBefore = function childBefore (pos) {
  if (pos == 0) { return {node: null, index: 0, offset: 0} }
  var ref = this.content.findIndex(pos);
    var index = ref.index;
    var offset = ref.offset;
  if (offset < pos) { return {node: this.content.child(index), index: index, offset: offset} }
  var node = this.content.child(index - 1);
  return {node: node, index: index - 1, offset: offset - node.nodeSize}
};

// :: (number) → ResolvedPos
// Resolve the given position in the document, returning an
// [object](#model.ResolvedPos) with information about its context.
Node.prototype.resolve = function resolve (pos) { return ResolvedPos.resolveCached(this, pos) };

Node.prototype.resolveNoCache = function resolveNoCache (pos) { return ResolvedPos.resolve(this, pos) };

// :: (number, number, union<Mark, MarkType>) → bool
// Test whether a given mark or mark type occurs in this document
// between the two given positions.
Node.prototype.rangeHasMark = function rangeHasMark (from, to, type) {
  var found = false;
  if (to > from) { this.nodesBetween(from, to, function (node) {
    if (type.isInSet(node.marks)) { found = true; }
    return !found
  }); }
  return found
};

// :: bool
// True when this is a block (non-inline node)
prototypeAccessors$3$1.isBlock.get = function () { return this.type.isBlock };

// :: bool
// True when this is a textblock node, a block node with inline
// content.
prototypeAccessors$3$1.isTextblock.get = function () { return this.type.isTextblock };

// :: bool
// True when this node allows inline content.
prototypeAccessors$3$1.inlineContent.get = function () { return this.type.inlineContent };

// :: bool
// True when this is an inline node (a text node or a node that can
// appear among text).
prototypeAccessors$3$1.isInline.get = function () { return this.type.isInline };

// :: bool
// True when this is a text node.
prototypeAccessors$3$1.isText.get = function () { return this.type.isText };

// :: bool
// True when this is a leaf node.
prototypeAccessors$3$1.isLeaf.get = function () { return this.type.isLeaf };

// :: bool
// True when this is an atom, i.e. when it does not have directly
// editable content. This is usually the same as `isLeaf`, but can
// be configured with the [`atom` property](#model.NodeSpec.atom) on
// a node's spec (typically used when the node is displayed as an
// uneditable [node view](#view.NodeView)).
prototypeAccessors$3$1.isAtom.get = function () { return this.type.isAtom };

// :: () → string
// Return a string representation of this node for debugging
// purposes.
Node.prototype.toString = function toString () {
  if (this.type.spec.toDebugString) { return this.type.spec.toDebugString(this) }
  var name = this.type.name;
  if (this.content.size)
    { name += "(" + this.content.toStringInner() + ")"; }
  return wrapMarks(this.marks, name)
};

// :: (number) → ContentMatch
// Get the content match in this node at the given index.
Node.prototype.contentMatchAt = function contentMatchAt (index) {
  var match = this.type.contentMatch.matchFragment(this.content, 0, index);
  if (!match) { throw new Error("Called contentMatchAt on a node with invalid content") }
  return match
};

// :: (number, number, ?Fragment, ?number, ?number) → bool
// Test whether replacing the range between `from` and `to` (by
// child index) with the given replacement fragment (which defaults
// to the empty fragment) would leave the node's content valid. You
// can optionally pass `start` and `end` indices into the
// replacement fragment.
Node.prototype.canReplace = function canReplace (from, to, replacement, start, end) {
    if ( replacement === void 0 ) replacement = Fragment.empty;
    if ( start === void 0 ) start = 0;
    if ( end === void 0 ) end = replacement.childCount;

  var one = this.contentMatchAt(from).matchFragment(replacement, start, end);
  var two = one && one.matchFragment(this.content, to);
  if (!two || !two.validEnd) { return false }
  for (var i = start; i < end; i++) { if (!this.type.allowsMarks(replacement.child(i).marks)) { return false } }
  return true
};

// :: (number, number, NodeType, ?[Mark]) → bool
// Test whether replacing the range `from` to `to` (by index) with a
// node of the given type would leave the node's content valid.
Node.prototype.canReplaceWith = function canReplaceWith (from, to, type, marks) {
  if (marks && !this.type.allowsMarks(marks)) { return false }
  var start = this.contentMatchAt(from).matchType(type);
  var end = start && start.matchFragment(this.content, to);
  return end ? end.validEnd : false
};

// :: (Node) → bool
// Test whether the given node's content could be appended to this
// node. If that node is empty, this will only return true if there
// is at least one node type that can appear in both nodes (to avoid
// merging completely incompatible nodes).
Node.prototype.canAppend = function canAppend (other) {
  if (other.content.size) { return this.canReplace(this.childCount, this.childCount, other.content) }
  else { return this.type.compatibleContent(other.type) }
};

// :: ()
// Check whether this node and its descendants conform to the
// schema, and raise error when they do not.
Node.prototype.check = function check () {
  if (!this.type.validContent(this.content))
    { throw new RangeError(("Invalid content for node " + (this.type.name) + ": " + (this.content.toString().slice(0, 50)))) }
  var copy = Mark.none;
  for (var i = 0; i < this.marks.length; i++) { copy = this.marks[i].addToSet(copy); }
  if (!Mark.sameSet(copy, this.marks))
    { throw new RangeError(("Invalid collection of marks for node " + (this.type.name) + ": " + (this.marks.map(function (m) { return m.type.name; })))) }
  this.content.forEach(function (node) { return node.check(); });
};

// :: () → Object
// Return a JSON-serializeable representation of this node.
Node.prototype.toJSON = function toJSON () {
  var obj = {type: this.type.name};
  for (var _ in this.attrs) {
    obj.attrs = this.attrs;
    break
  }
  if (this.content.size)
    { obj.content = this.content.toJSON(); }
  if (this.marks.length)
    { obj.marks = this.marks.map(function (n) { return n.toJSON(); }); }
  return obj
};

// :: (Schema, Object) → Node
// Deserialize a node from its JSON representation.
Node.fromJSON = function fromJSON (schema, json) {
  if (!json) { throw new RangeError("Invalid input for Node.fromJSON") }
  var marks = null;
  if (json.marks) {
    if (!Array.isArray(json.marks)) { throw new RangeError("Invalid mark data for Node.fromJSON") }
    marks = json.marks.map(schema.markFromJSON);
  }
  if (json.type == "text") {
    if (typeof json.text != "string") { throw new RangeError("Invalid text node in JSON") }
    return schema.text(json.text, marks)
  }
  var content = Fragment.fromJSON(schema, json.content);
  return schema.nodeType(json.type).create(json.attrs, content, marks)
};

Object.defineProperties( Node.prototype, prototypeAccessors$3$1 );

function wrapMarks(marks, str) {
  for (var i = marks.length - 1; i >= 0; i--)
    { str = marks[i].type.name + "(" + str + ")"; }
  return str
}

// ::- Instances of this class represent a match state of a node
// type's [content expression](#model.NodeSpec.content), and can be
// used to find out whether further content matches here, and whether
// a given position is a valid end of the node.
var ContentMatch = function ContentMatch(validEnd) {
  // :: bool
  // True when this match state represents a valid end of the node.
  this.validEnd = validEnd;
  this.next = [];
  this.wrapCache = [];
};

var prototypeAccessors$4 = { inlineContent: { configurable: true },defaultType: { configurable: true },edgeCount: { configurable: true } };

ContentMatch.parse = function parse (string, nodeTypes) {
  var stream = new TokenStream(string, nodeTypes);
  if (stream.next == null) { return ContentMatch.empty }
  var expr = parseExpr(stream);
  if (stream.next) { stream.err("Unexpected trailing text"); }
  var match = dfa(nfa(expr));
  checkForDeadEnds(match, stream);
  return match
};

// :: (NodeType) → ?ContentMatch
// Match a node type, returning a match after that node if
// successful.
ContentMatch.prototype.matchType = function matchType (type) {
  for (var i = 0; i < this.next.length; i += 2)
    { if (this.next[i] == type) { return this.next[i + 1] } }
  return null
};

// :: (Fragment, ?number, ?number) → ?ContentMatch
// Try to match a fragment. Returns the resulting match when
// successful.
ContentMatch.prototype.matchFragment = function matchFragment (frag, start, end) {
    if ( start === void 0 ) start = 0;
    if ( end === void 0 ) end = frag.childCount;

  var cur = this;
  for (var i = start; cur && i < end; i++)
    { cur = cur.matchType(frag.child(i).type); }
  return cur
};

prototypeAccessors$4.inlineContent.get = function () {
  var first = this.next[0];
  return first ? first.isInline : false
};

// :: ?NodeType
// Get the first matching node type at this match position that can
// be generated.
prototypeAccessors$4.defaultType.get = function () {
  for (var i = 0; i < this.next.length; i += 2) {
    var type = this.next[i];
    if (!(type.isText || type.hasRequiredAttrs())) { return type }
  }
};

ContentMatch.prototype.compatible = function compatible (other) {
  for (var i = 0; i < this.next.length; i += 2)
    { for (var j = 0; j < other.next.length; j += 2)
      { if (this.next[i] == other.next[j]) { return true } } }
  return false
};

// :: (Fragment, bool, ?number) → ?Fragment
// Try to match the given fragment, and if that fails, see if it can
// be made to match by inserting nodes in front of it. When
// successful, return a fragment of inserted nodes (which may be
// empty if nothing had to be inserted). When `toEnd` is true, only
// return a fragment if the resulting match goes to the end of the
// content expression.
ContentMatch.prototype.fillBefore = function fillBefore (after, toEnd, startIndex) {
    if ( toEnd === void 0 ) toEnd = false;
    if ( startIndex === void 0 ) startIndex = 0;

  var seen = [this];
  function search(match, types) {
    var finished = match.matchFragment(after, startIndex);
    if (finished && (!toEnd || finished.validEnd))
      { return Fragment.from(types.map(function (tp) { return tp.createAndFill(); })) }

    for (var i = 0; i < match.next.length; i += 2) {
      var type = match.next[i], next = match.next[i + 1];
      if (!(type.isText || type.hasRequiredAttrs()) && seen.indexOf(next) == -1) {
        seen.push(next);
        var found = search(next, types.concat(type));
        if (found) { return found }
      }
    }
  }

  return search(this, [])
};

// :: (NodeType) → ?[NodeType]
// Find a set of wrapping node types that would allow a node of the
// given type to appear at this position. The result may be empty
// (when it fits directly) and will be null when no such wrapping
// exists.
ContentMatch.prototype.findWrapping = function findWrapping (target) {
  for (var i = 0; i < this.wrapCache.length; i += 2)
    { if (this.wrapCache[i] == target) { return this.wrapCache[i + 1] } }
  var computed = this.computeWrapping(target);
  this.wrapCache.push(target, computed);
  return computed
};

ContentMatch.prototype.computeWrapping = function computeWrapping (target) {
  var seen = Object.create(null), active = [{match: this, type: null, via: null}];
  while (active.length) {
    var current = active.shift(), match = current.match;
    if (match.matchType(target)) {
      var result = [];
      for (var obj = current; obj.type; obj = obj.via)
        { result.push(obj.type); }
      return result.reverse()
    }
    for (var i = 0; i < match.next.length; i += 2) {
      var type = match.next[i];
      if (!type.isLeaf && !type.hasRequiredAttrs() && !(type.name in seen) && (!current.type || match.next[i + 1].validEnd)) {
        active.push({match: type.contentMatch, type: type, via: current});
        seen[type.name] = true;
      }
    }
  }
};

// :: number
// The number of outgoing edges this node has in the finite
// automaton that describes the content expression.
prototypeAccessors$4.edgeCount.get = function () {
  return this.next.length >> 1
};

// :: (number) → {type: NodeType, next: ContentMatch}
// Get the _n_​th outgoing edge from this node in the finite
// automaton that describes the content expression.
ContentMatch.prototype.edge = function edge (n) {
  var i = n << 1;
  if (i >= this.next.length) { throw new RangeError(("There's no " + n + "th edge in this content match")) }
  return {type: this.next[i], next: this.next[i + 1]}
};

ContentMatch.prototype.toString = function toString () {
  var seen = [];
  function scan(m) {
    seen.push(m);
    for (var i = 1; i < m.next.length; i += 2)
      { if (seen.indexOf(m.next[i]) == -1) { scan(m.next[i]); } }
  }
  scan(this);
  return seen.map(function (m, i) {
    var out = i + (m.validEnd ? "*" : " ") + " ";
    for (var i$1 = 0; i$1 < m.next.length; i$1 += 2)
      { out += (i$1 ? ", " : "") + m.next[i$1].name + "->" + seen.indexOf(m.next[i$1 + 1]); }
    return out
  }).join("\n")
};

Object.defineProperties( ContentMatch.prototype, prototypeAccessors$4 );

ContentMatch.empty = new ContentMatch(true);

var TokenStream = function TokenStream(string, nodeTypes) {
  this.string = string;
  this.nodeTypes = nodeTypes;
  this.inline = null;
  this.pos = 0;
  this.tokens = string.split(/\s*(?=\b|\W|$)/);
  if (this.tokens[this.tokens.length - 1] == "") { this.tokens.pop(); }
  if (this.tokens[0] == "") { this.tokens.shift(); }
};

var prototypeAccessors$1$2$1 = { next: { configurable: true } };

prototypeAccessors$1$2$1.next.get = function () { return this.tokens[this.pos] };

TokenStream.prototype.eat = function eat (tok) { return this.next == tok && (this.pos++ || true) };

TokenStream.prototype.err = function err (str) { throw new SyntaxError(str + " (in content expression '" + this.string + "')") };

Object.defineProperties( TokenStream.prototype, prototypeAccessors$1$2$1 );

function parseExpr(stream) {
  var exprs = [];
  do { exprs.push(parseExprSeq(stream)); }
  while (stream.eat("|"))
  return exprs.length == 1 ? exprs[0] : {type: "choice", exprs: exprs}
}

function parseExprSeq(stream) {
  var exprs = [];
  do { exprs.push(parseExprSubscript(stream)); }
  while (stream.next && stream.next != ")" && stream.next != "|")
  return exprs.length == 1 ? exprs[0] : {type: "seq", exprs: exprs}
}

function parseExprSubscript(stream) {
  var expr = parseExprAtom(stream);
  for (;;) {
    if (stream.eat("+"))
      { expr = {type: "plus", expr: expr}; }
    else if (stream.eat("*"))
      { expr = {type: "star", expr: expr}; }
    else if (stream.eat("?"))
      { expr = {type: "opt", expr: expr}; }
    else if (stream.eat("{"))
      { expr = parseExprRange(stream, expr); }
    else { break }
  }
  return expr
}

function parseNum(stream) {
  if (/\D/.test(stream.next)) { stream.err("Expected number, got '" + stream.next + "'"); }
  var result = Number(stream.next);
  stream.pos++;
  return result
}

function parseExprRange(stream, expr) {
  var min = parseNum(stream), max = min;
  if (stream.eat(",")) {
    if (stream.next != "}") { max = parseNum(stream); }
    else { max = -1; }
  }
  if (!stream.eat("}")) { stream.err("Unclosed braced range"); }
  return {type: "range", min: min, max: max, expr: expr}
}

function resolveName(stream, name) {
  var types = stream.nodeTypes, type = types[name];
  if (type) { return [type] }
  var result = [];
  for (var typeName in types) {
    var type$1 = types[typeName];
    if (type$1.groups.indexOf(name) > -1) { result.push(type$1); }
  }
  if (result.length == 0) { stream.err("No node type or group '" + name + "' found"); }
  return result
}

function parseExprAtom(stream) {
  if (stream.eat("(")) {
    var expr = parseExpr(stream);
    if (!stream.eat(")")) { stream.err("Missing closing paren"); }
    return expr
  } else if (!/\W/.test(stream.next)) {
    var exprs = resolveName(stream, stream.next).map(function (type) {
      if (stream.inline == null) { stream.inline = type.isInline; }
      else if (stream.inline != type.isInline) { stream.err("Mixing inline and block content"); }
      return {type: "name", value: type}
    });
    stream.pos++;
    return exprs.length == 1 ? exprs[0] : {type: "choice", exprs: exprs}
  } else {
    stream.err("Unexpected token '" + stream.next + "'");
  }
}

// The code below helps compile a regular-expression-like language
// into a deterministic finite automaton. For a good introduction to
// these concepts, see https://swtch.com/~rsc/regexp/regexp1.html

// : (Object) → [[{term: ?any, to: number}]]
// Construct an NFA from an expression as returned by the parser. The
// NFA is represented as an array of states, which are themselves
// arrays of edges, which are `{term, to}` objects. The first state is
// the entry state and the last node is the success state.
//
// Note that unlike typical NFAs, the edge ordering in this one is
// significant, in that it is used to contruct filler content when
// necessary.
function nfa(expr) {
  var nfa = [[]];
  connect(compile(expr, 0), node());
  return nfa

  function node() { return nfa.push([]) - 1 }
  function edge(from, to, term) {
    var edge = {term: term, to: to};
    nfa[from].push(edge);
    return edge
  }
  function connect(edges, to) { edges.forEach(function (edge) { return edge.to = to; }); }

  function compile(expr, from) {
    if (expr.type == "choice") {
      return expr.exprs.reduce(function (out, expr) { return out.concat(compile(expr, from)); }, [])
    } else if (expr.type == "seq") {
      for (var i = 0;; i++) {
        var next = compile(expr.exprs[i], from);
        if (i == expr.exprs.length - 1) { return next }
        connect(next, from = node());
      }
    } else if (expr.type == "star") {
      var loop = node();
      edge(from, loop);
      connect(compile(expr.expr, loop), loop);
      return [edge(loop)]
    } else if (expr.type == "plus") {
      var loop$1 = node();
      connect(compile(expr.expr, from), loop$1);
      connect(compile(expr.expr, loop$1), loop$1);
      return [edge(loop$1)]
    } else if (expr.type == "opt") {
      return [edge(from)].concat(compile(expr.expr, from))
    } else if (expr.type == "range") {
      var cur = from;
      for (var i$1 = 0; i$1 < expr.min; i$1++) {
        var next$1 = node();
        connect(compile(expr.expr, cur), next$1);
        cur = next$1;
      }
      if (expr.max == -1) {
        connect(compile(expr.expr, cur), cur);
      } else {
        for (var i$2 = expr.min; i$2 < expr.max; i$2++) {
          var next$2 = node();
          edge(cur, next$2);
          connect(compile(expr.expr, cur), next$2);
          cur = next$2;
        }
      }
      return [edge(cur)]
    } else if (expr.type == "name") {
      return [edge(from, null, expr.value)]
    }
  }
}

function cmp(a, b) { return b - a }

// Get the set of nodes reachable by null edges from `node`. Omit
// nodes with only a single null-out-edge, since they may lead to
// needless duplicated nodes.
function nullFrom(nfa, node) {
  var result = [];
  scan(node);
  return result.sort(cmp)

  function scan(node) {
    var edges = nfa[node];
    if (edges.length == 1 && !edges[0].term) { return scan(edges[0].to) }
    result.push(node);
    for (var i = 0; i < edges.length; i++) {
      var ref = edges[i];
      var term = ref.term;
      var to = ref.to;
      if (!term && result.indexOf(to) == -1) { scan(to); }
    }
  }
}

// : ([[{term: ?any, to: number}]]) → ContentMatch
// Compiles an NFA as produced by `nfa` into a DFA, modeled as a set
// of state objects (`ContentMatch` instances) with transitions
// between them.
function dfa(nfa) {
  var labeled = Object.create(null);
  return explore(nullFrom(nfa, 0))

  function explore(states) {
    var out = [];
    states.forEach(function (node) {
      nfa[node].forEach(function (ref) {
        var term = ref.term;
        var to = ref.to;

        if (!term) { return }
        var known = out.indexOf(term), set = known > -1 && out[known + 1];
        nullFrom(nfa, to).forEach(function (node) {
          if (!set) { out.push(term, set = []); }
          if (set.indexOf(node) == -1) { set.push(node); }
        });
      });
    });
    var state = labeled[states.join(",")] = new ContentMatch(states.indexOf(nfa.length - 1) > -1);
    for (var i = 0; i < out.length; i += 2) {
      var states$1 = out[i + 1].sort(cmp);
      state.next.push(out[i], labeled[states$1.join(",")] || explore(states$1));
    }
    return state
  }
}

function checkForDeadEnds(match, stream) {
  for (var i = 0, work = [match]; i < work.length; i++) {
    var state = work[i], dead = !state.validEnd, nodes = [];
    for (var j = 0; j < state.next.length; j += 2) {
      var node = state.next[j], next = state.next[j + 1];
      nodes.push(node.name);
      if (dead && !(node.isText || node.hasRequiredAttrs())) { dead = false; }
      if (work.indexOf(next) == -1) { work.push(next); }
    }
    if (dead) { stream.err("Only non-generatable nodes (" + nodes.join(", ") + ") in a required position (see https://prosemirror.net/docs/guide/#generatable)"); }
  }
}

// For node types where all attrs have a default value (or which don't
// have any attributes), build up a single reusable default attribute
// object, and use it for all nodes that don't specify specific
// attributes.
function defaultAttrs(attrs) {
  var defaults = Object.create(null);
  for (var attrName in attrs) {
    var attr = attrs[attrName];
    if (!attr.hasDefault) { return null }
    defaults[attrName] = attr.default;
  }
  return defaults
}

function computeAttrs(attrs, value) {
  var built = Object.create(null);
  for (var name in attrs) {
    var given = value && value[name];
    if (given === undefined) {
      var attr = attrs[name];
      if (attr.hasDefault) { given = attr.default; }
      else { throw new RangeError("No value supplied for attribute " + name) }
    }
    built[name] = given;
  }
  return built
}

function initAttrs(attrs) {
  var result = Object.create(null);
  if (attrs) { for (var name in attrs) { result[name] = new Attribute(attrs[name]); } }
  return result
}

// ::- Node types are objects allocated once per `Schema` and used to
// [tag](#model.Node.type) `Node` instances. They contain information
// about the node type, such as its name and what kind of node it
// represents.
var NodeType = function NodeType(name, schema, spec) {
  // :: string
  // The name the node type has in this schema.
  this.name = name;

  // :: Schema
  // A link back to the `Schema` the node type belongs to.
  this.schema = schema;

  // :: NodeSpec
  // The spec that this type is based on
  this.spec = spec;

  this.groups = spec.group ? spec.group.split(" ") : [];
  this.attrs = initAttrs(spec.attrs);

  this.defaultAttrs = defaultAttrs(this.attrs);

  // :: ContentMatch
  // The starting match of the node type's content expression.
  this.contentMatch = null;

  // : ?[MarkType]
  // The set of marks allowed in this node. `null` means all marks
  // are allowed.
  this.markSet = null;

  // :: bool
  // True if this node type has inline content.
  this.inlineContent = null;

  // :: bool
  // True if this is a block type
  this.isBlock = !(spec.inline || name == "text");

  // :: bool
  // True if this is the text node type.
  this.isText = name == "text";
};

var prototypeAccessors$5 = { isInline: { configurable: true },isTextblock: { configurable: true },isLeaf: { configurable: true },isAtom: { configurable: true } };

// :: bool
// True if this is an inline type.
prototypeAccessors$5.isInline.get = function () { return !this.isBlock };

// :: bool
// True if this is a textblock type, a block that contains inline
// content.
prototypeAccessors$5.isTextblock.get = function () { return this.isBlock && this.inlineContent };

// :: bool
// True for node types that allow no content.
prototypeAccessors$5.isLeaf.get = function () { return this.contentMatch == ContentMatch.empty };

// :: bool
// True when this node is an atom, i.e. when it does not have
// directly editable content.
prototypeAccessors$5.isAtom.get = function () { return this.isLeaf || this.spec.atom };

// :: () → bool
// Tells you whether this node type has any required attributes.
NodeType.prototype.hasRequiredAttrs = function hasRequiredAttrs () {
  for (var n in this.attrs) { if (this.attrs[n].isRequired) { return true } }
  return false
};

NodeType.prototype.compatibleContent = function compatibleContent (other) {
  return this == other || this.contentMatch.compatible(other.contentMatch)
};

NodeType.prototype.computeAttrs = function computeAttrs$1 (attrs) {
  if (!attrs && this.defaultAttrs) { return this.defaultAttrs }
  else { return computeAttrs(this.attrs, attrs) }
};

// :: (?Object, ?union<Fragment, Node, [Node]>, ?[Mark]) → Node
// Create a `Node` of this type. The given attributes are
// checked and defaulted (you can pass `null` to use the type's
// defaults entirely, if no required attributes exist). `content`
// may be a `Fragment`, a node, an array of nodes, or
// `null`. Similarly `marks` may be `null` to default to the empty
// set of marks.
NodeType.prototype.create = function create (attrs, content, marks) {
  if (this.isText) { throw new Error("NodeType.create can't construct text nodes") }
  return new Node(this, this.computeAttrs(attrs), Fragment.from(content), Mark.setFrom(marks))
};

// :: (?Object, ?union<Fragment, Node, [Node]>, ?[Mark]) → Node
// Like [`create`](#model.NodeType.create), but check the given content
// against the node type's content restrictions, and throw an error
// if it doesn't match.
NodeType.prototype.createChecked = function createChecked (attrs, content, marks) {
  content = Fragment.from(content);
  if (!this.validContent(content))
    { throw new RangeError("Invalid content for node " + this.name) }
  return new Node(this, this.computeAttrs(attrs), content, Mark.setFrom(marks))
};

// :: (?Object, ?union<Fragment, Node, [Node]>, ?[Mark]) → ?Node
// Like [`create`](#model.NodeType.create), but see if it is necessary to
// add nodes to the start or end of the given fragment to make it
// fit the node. If no fitting wrapping can be found, return null.
// Note that, due to the fact that required nodes can always be
// created, this will always succeed if you pass null or
// `Fragment.empty` as content.
NodeType.prototype.createAndFill = function createAndFill (attrs, content, marks) {
  attrs = this.computeAttrs(attrs);
  content = Fragment.from(content);
  if (content.size) {
    var before = this.contentMatch.fillBefore(content);
    if (!before) { return null }
    content = before.append(content);
  }
  var after = this.contentMatch.matchFragment(content).fillBefore(Fragment.empty, true);
  if (!after) { return null }
  return new Node(this, attrs, content.append(after), Mark.setFrom(marks))
};

// :: (Fragment) → bool
// Returns true if the given fragment is valid content for this node
// type with the given attributes.
NodeType.prototype.validContent = function validContent (content) {
  var result = this.contentMatch.matchFragment(content);
  if (!result || !result.validEnd) { return false }
  for (var i = 0; i < content.childCount; i++)
    { if (!this.allowsMarks(content.child(i).marks)) { return false } }
  return true
};

// :: (MarkType) → bool
// Check whether the given mark type is allowed in this node.
NodeType.prototype.allowsMarkType = function allowsMarkType (markType) {
  return this.markSet == null || this.markSet.indexOf(markType) > -1
};

// :: ([Mark]) → bool
// Test whether the given set of marks are allowed in this node.
NodeType.prototype.allowsMarks = function allowsMarks (marks) {
  if (this.markSet == null) { return true }
  for (var i = 0; i < marks.length; i++) { if (!this.allowsMarkType(marks[i].type)) { return false } }
  return true
};

// :: ([Mark]) → [Mark]
// Removes the marks that are not allowed in this node from the given set.
NodeType.prototype.allowedMarks = function allowedMarks (marks) {
  if (this.markSet == null) { return marks }
  var copy;
  for (var i = 0; i < marks.length; i++) {
    if (!this.allowsMarkType(marks[i].type)) {
      if (!copy) { copy = marks.slice(0, i); }
    } else if (copy) {
      copy.push(marks[i]);
    }
  }
  return !copy ? marks : copy.length ? copy : Mark.empty
};

NodeType.compile = function compile (nodes, schema) {
  var result = Object.create(null);
  nodes.forEach(function (name, spec) { return result[name] = new NodeType(name, schema, spec); });

  var topType = schema.spec.topNode || "doc";
  if (!result[topType]) { throw new RangeError("Schema is missing its top node type ('" + topType + "')") }
  if (!result.text) { throw new RangeError("Every schema needs a 'text' type") }
  for (var _ in result.text.attrs) { throw new RangeError("The text node type should not have attributes") }

  return result
};

Object.defineProperties( NodeType.prototype, prototypeAccessors$5 );

// Attribute descriptors

var Attribute = function Attribute(options) {
  this.hasDefault = Object.prototype.hasOwnProperty.call(options, "default");
  this.default = options.default;
};

var prototypeAccessors$1$3 = { isRequired: { configurable: true } };

prototypeAccessors$1$3.isRequired.get = function () {
  return !this.hasDefault
};

Object.defineProperties( Attribute.prototype, prototypeAccessors$1$3 );

// Marks

// ::- Like nodes, marks (which are associated with nodes to signify
// things like emphasis or being part of a link) are
// [tagged](#model.Mark.type) with type objects, which are
// instantiated once per `Schema`.
var MarkType = function MarkType(name, rank, schema, spec) {
  // :: string
  // The name of the mark type.
  this.name = name;

  // :: Schema
  // The schema that this mark type instance is part of.
  this.schema = schema;

  // :: MarkSpec
  // The spec on which the type is based.
  this.spec = spec;

  this.attrs = initAttrs(spec.attrs);

  this.rank = rank;
  this.excluded = null;
  var defaults = defaultAttrs(this.attrs);
  this.instance = defaults && new Mark(this, defaults);
};

// :: (?Object) → Mark
// Create a mark of this type. `attrs` may be `null` or an object
// containing only some of the mark's attributes. The others, if
// they have defaults, will be added.
MarkType.prototype.create = function create (attrs) {
  if (!attrs && this.instance) { return this.instance }
  return new Mark(this, computeAttrs(this.attrs, attrs))
};

MarkType.compile = function compile (marks, schema) {
  var result = Object.create(null), rank = 0;
  marks.forEach(function (name, spec) { return result[name] = new MarkType(name, rank++, schema, spec); });
  return result
};

// :: ([Mark]) → [Mark]
// When there is a mark of this type in the given set, a new set
// without it is returned. Otherwise, the input set is returned.
MarkType.prototype.removeFromSet = function removeFromSet (set) {
  for (var i = 0; i < set.length; i++) { if (set[i].type == this) {
    set = set.slice(0, i).concat(set.slice(i + 1));
    i--;
  } }
  return set
};

// :: ([Mark]) → ?Mark
// Tests whether there is a mark of this type in the given set.
MarkType.prototype.isInSet = function isInSet (set) {
  for (var i = 0; i < set.length; i++)
    { if (set[i].type == this) { return set[i] } }
};

// :: (MarkType) → bool
// Queries whether a given mark type is
// [excluded](#model.MarkSpec.excludes) by this one.
MarkType.prototype.excludes = function excludes (other) {
  return this.excluded.indexOf(other) > -1
};

// : Object<bool> The block-level tags in HTML5
var blockTags = {
  address: true, article: true, aside: true, blockquote: true, canvas: true,
  dd: true, div: true, dl: true, fieldset: true, figcaption: true, figure: true,
  footer: true, form: true, h1: true, h2: true, h3: true, h4: true, h5: true,
  h6: true, header: true, hgroup: true, hr: true, li: true, noscript: true, ol: true,
  output: true, p: true, pre: true, section: true, table: true, tfoot: true, ul: true
};

// : Object<bool> The tags that we normally ignore.
var ignoreTags = {
  head: true, noscript: true, object: true, script: true, style: true, title: true
};

// : Object<bool> List tags.
var listTags = {ol: true, ul: true};

// Using a bitfield for node context options
var OPT_PRESERVE_WS = 1, OPT_PRESERVE_WS_FULL = 2, OPT_OPEN_LEFT = 4;

function wsOptionsFor(preserveWhitespace) {
  return (preserveWhitespace ? OPT_PRESERVE_WS : 0) | (preserveWhitespace === "full" ? OPT_PRESERVE_WS_FULL : 0)
}

var NodeContext = function NodeContext(type, attrs, marks, pendingMarks, solid, match, options) {
  this.type = type;
  this.attrs = attrs;
  this.solid = solid;
  this.match = match || (options & OPT_OPEN_LEFT ? null : type.contentMatch);
  this.options = options;
  this.content = [];
  // Marks applied to this node itself
  this.marks = marks;
  // Marks applied to its children
  this.activeMarks = Mark.none;
  // Marks that can't apply here, but will be used in children if possible
  this.pendingMarks = pendingMarks;
  // Nested Marks with same type
  this.stashMarks = [];
};

NodeContext.prototype.findWrapping = function findWrapping (node) {
  if (!this.match) {
    if (!this.type) { return [] }
    var fill = this.type.contentMatch.fillBefore(Fragment.from(node));
    if (fill) {
      this.match = this.type.contentMatch.matchFragment(fill);
    } else {
      var start = this.type.contentMatch, wrap;
      if (wrap = start.findWrapping(node.type)) {
        this.match = start;
        return wrap
      } else {
        return null
      }
    }
  }
  return this.match.findWrapping(node.type)
};

NodeContext.prototype.finish = function finish (openEnd) {
  if (!(this.options & OPT_PRESERVE_WS)) { // Strip trailing whitespace
    var last = this.content[this.content.length - 1], m;
    if (last && last.isText && (m = /[ \t\r\n\u000c]+$/.exec(last.text))) {
      if (last.text.length == m[0].length) { this.content.pop(); }
      else { this.content[this.content.length - 1] = last.withText(last.text.slice(0, last.text.length - m[0].length)); }
    }
  }
  var content = Fragment.from(this.content);
  if (!openEnd && this.match)
    { content = content.append(this.match.fillBefore(Fragment.empty, true)); }
  return this.type ? this.type.create(this.attrs, content, this.marks) : content
};

NodeContext.prototype.popFromStashMark = function popFromStashMark (mark) {
  for (var i = this.stashMarks.length - 1; i >= 0; i--)
    { if (mark.eq(this.stashMarks[i])) { return this.stashMarks.splice(i, 1)[0] } }
};

NodeContext.prototype.applyPending = function applyPending (nextType) {
  for (var i = 0, pending = this.pendingMarks; i < pending.length; i++) {
    var mark = pending[i];
    if ((this.type ? this.type.allowsMarkType(mark.type) : markMayApply(mark.type, nextType)) &&
        !mark.isInSet(this.activeMarks)) {
      this.activeMarks = mark.addToSet(this.activeMarks);
      this.pendingMarks = mark.removeFromSet(this.pendingMarks);
    }
  }
};

NodeContext.prototype.inlineContext = function inlineContext (node) {
  if (this.type) { return this.type.inlineContent }
  if (this.content.length) { return this.content[0].isInline }
  return node.parentNode && !blockTags.hasOwnProperty(node.parentNode.nodeName.toLowerCase())
};

var ParseContext = function ParseContext(parser, options, open) {
  // : DOMParser The parser we are using.
  this.parser = parser;
  // : Object The options passed to this parse.
  this.options = options;
  this.isOpen = open;
  var topNode = options.topNode, topContext;
  var topOptions = wsOptionsFor(options.preserveWhitespace) | (open ? OPT_OPEN_LEFT : 0);
  if (topNode)
    { topContext = new NodeContext(topNode.type, topNode.attrs, Mark.none, Mark.none, true,
                                 options.topMatch || topNode.type.contentMatch, topOptions); }
  else if (open)
    { topContext = new NodeContext(null, null, Mark.none, Mark.none, true, null, topOptions); }
  else
    { topContext = new NodeContext(parser.schema.topNodeType, null, Mark.none, Mark.none, true, null, topOptions); }
  this.nodes = [topContext];
  // : [Mark] The current set of marks
  this.open = 0;
  this.find = options.findPositions;
  this.needsBlock = false;
};

var prototypeAccessors$6 = { top: { configurable: true },currentPos: { configurable: true } };

prototypeAccessors$6.top.get = function () {
  return this.nodes[this.open]
};

// : (dom.Node)
// Add a DOM node to the content. Text is inserted as text node,
// otherwise, the node is passed to `addElement` or, if it has a
// `style` attribute, `addElementWithStyles`.
ParseContext.prototype.addDOM = function addDOM (dom) {
  if (dom.nodeType == 3) {
    this.addTextNode(dom);
  } else if (dom.nodeType == 1) {
    var style = dom.getAttribute("style");
    var marks = style ? this.readStyles(parseStyles(style)) : null, top = this.top;
    if (marks != null) { for (var i = 0; i < marks.length; i++) { this.addPendingMark(marks[i]); } }
    this.addElement(dom);
    if (marks != null) { for (var i$1 = 0; i$1 < marks.length; i$1++) { this.removePendingMark(marks[i$1], top); } }
  }
};

ParseContext.prototype.addTextNode = function addTextNode (dom) {
  var value = dom.nodeValue;
  var top = this.top;
  if (top.options & OPT_PRESERVE_WS_FULL ||
      top.inlineContext(dom) ||
      /[^ \t\r\n\u000c]/.test(value)) {
    if (!(top.options & OPT_PRESERVE_WS)) {
      value = value.replace(/[ \t\r\n\u000c]+/g, " ");
      // If this starts with whitespace, and there is no node before it, or
      // a hard break, or a text node that ends with whitespace, strip the
      // leading space.
      if (/^[ \t\r\n\u000c]/.test(value) && this.open == this.nodes.length - 1) {
        var nodeBefore = top.content[top.content.length - 1];
        var domNodeBefore = dom.previousSibling;
        if (!nodeBefore ||
            (domNodeBefore && domNodeBefore.nodeName == 'BR') ||
            (nodeBefore.isText && /[ \t\r\n\u000c]$/.test(nodeBefore.text)))
          { value = value.slice(1); }
      }
    } else if (!(top.options & OPT_PRESERVE_WS_FULL)) {
      value = value.replace(/\r?\n|\r/g, " ");
    } else {
      value = value.replace(/\r\n?/g, "\n");
    }
    if (value) { this.insertNode(this.parser.schema.text(value)); }
    this.findInText(dom);
  } else {
    this.findInside(dom);
  }
};

// : (dom.Element, ?ParseRule)
// Try to find a handler for the given tag and use that to parse. If
// none is found, the element's content nodes are added directly.
ParseContext.prototype.addElement = function addElement (dom, matchAfter) {
  var name = dom.nodeName.toLowerCase(), ruleID;
  if (listTags.hasOwnProperty(name) && this.parser.normalizeLists) { normalizeList(dom); }
  var rule = (this.options.ruleFromNode && this.options.ruleFromNode(dom)) ||
      (ruleID = this.parser.matchTag(dom, this, matchAfter));
  if (rule ? rule.ignore : ignoreTags.hasOwnProperty(name)) {
    this.findInside(dom);
    this.ignoreFallback(dom);
  } else if (!rule || rule.skip || rule.closeParent) {
    if (rule && rule.closeParent) { this.open = Math.max(0, this.open - 1); }
    else if (rule && rule.skip.nodeType) { dom = rule.skip; }
    var sync, top = this.top, oldNeedsBlock = this.needsBlock;
    if (blockTags.hasOwnProperty(name)) {
      sync = true;
      if (!top.type) { this.needsBlock = true; }
    } else if (!dom.firstChild) {
      this.leafFallback(dom);
      return
    }
    this.addAll(dom);
    if (sync) { this.sync(top); }
    this.needsBlock = oldNeedsBlock;
  } else {
    this.addElementByRule(dom, rule, rule.consuming === false ? ruleID : null);
  }
};

// Called for leaf DOM nodes that would otherwise be ignored
ParseContext.prototype.leafFallback = function leafFallback (dom) {
  if (dom.nodeName == "BR" && this.top.type && this.top.type.inlineContent)
    { this.addTextNode(dom.ownerDocument.createTextNode("\n")); }
};

// Called for ignored nodes
ParseContext.prototype.ignoreFallback = function ignoreFallback (dom) {
  // Ignored BR nodes should at least create an inline context
  if (dom.nodeName == "BR" && (!this.top.type || !this.top.type.inlineContent))
    { this.findPlace(this.parser.schema.text("-")); }
};

// Run any style parser associated with the node's styles. Either
// return an array of marks, or null to indicate some of the styles
// had a rule with `ignore` set.
ParseContext.prototype.readStyles = function readStyles (styles) {
  var marks = Mark.none;
  style: for (var i = 0; i < styles.length; i += 2) {
    for (var after = null;;) {
      var rule = this.parser.matchStyle(styles[i], styles[i + 1], this, after);
      if (!rule) { continue style }
      if (rule.ignore) { return null }
      marks = this.parser.schema.marks[rule.mark].create(rule.attrs).addToSet(marks);
      if (rule.consuming === false) { after = rule; }
      else { break }
    }
  }
  return marks
};

// : (dom.Element, ParseRule) → bool
// Look up a handler for the given node. If none are found, return
// false. Otherwise, apply it, use its return value to drive the way
// the node's content is wrapped, and return true.
ParseContext.prototype.addElementByRule = function addElementByRule (dom, rule, continueAfter) {
    var this$1$1 = this;

  var sync, nodeType, markType, mark;
  if (rule.node) {
    nodeType = this.parser.schema.nodes[rule.node];
    if (!nodeType.isLeaf) {
      sync = this.enter(nodeType, rule.attrs, rule.preserveWhitespace);
    } else if (!this.insertNode(nodeType.create(rule.attrs))) {
      this.leafFallback(dom);
    }
  } else {
    markType = this.parser.schema.marks[rule.mark];
    mark = markType.create(rule.attrs);
    this.addPendingMark(mark);
  }
  var startIn = this.top;

  if (nodeType && nodeType.isLeaf) {
    this.findInside(dom);
  } else if (continueAfter) {
    this.addElement(dom, continueAfter);
  } else if (rule.getContent) {
    this.findInside(dom);
    rule.getContent(dom, this.parser.schema).forEach(function (node) { return this$1$1.insertNode(node); });
  } else {
    var contentDOM = rule.contentElement;
    if (typeof contentDOM == "string") { contentDOM = dom.querySelector(contentDOM); }
    else if (typeof contentDOM == "function") { contentDOM = contentDOM(dom); }
    if (!contentDOM) { contentDOM = dom; }
    this.findAround(dom, contentDOM, true);
    this.addAll(contentDOM, sync);
  }
  if (sync) { this.sync(startIn); this.open--; }
  if (mark) { this.removePendingMark(mark, startIn); }
};

// : (dom.Node, ?NodeBuilder, ?number, ?number)
// Add all child nodes between `startIndex` and `endIndex` (or the
// whole node, if not given). If `sync` is passed, use it to
// synchronize after every block element.
ParseContext.prototype.addAll = function addAll (parent, sync, startIndex, endIndex) {
  var index = startIndex || 0;
  for (var dom = startIndex ? parent.childNodes[startIndex] : parent.firstChild,
           end = endIndex == null ? null : parent.childNodes[endIndex];
       dom != end; dom = dom.nextSibling, ++index) {
    this.findAtPoint(parent, index);
    this.addDOM(dom);
    if (sync && blockTags.hasOwnProperty(dom.nodeName.toLowerCase()))
      { this.sync(sync); }
  }
  this.findAtPoint(parent, index);
};

// Try to find a way to fit the given node type into the current
// context. May add intermediate wrappers and/or leave non-solid
// nodes that we're in.
ParseContext.prototype.findPlace = function findPlace (node) {
  var route, sync;
  for (var depth = this.open; depth >= 0; depth--) {
    var cx = this.nodes[depth];
    var found = cx.findWrapping(node);
    if (found && (!route || route.length > found.length)) {
      route = found;
      sync = cx;
      if (!found.length) { break }
    }
    if (cx.solid) { break }
  }
  if (!route) { return false }
  this.sync(sync);
  for (var i = 0; i < route.length; i++)
    { this.enterInner(route[i], null, false); }
  return true
};

// : (Node) → ?Node
// Try to insert the given node, adjusting the context when needed.
ParseContext.prototype.insertNode = function insertNode (node) {
  if (node.isInline && this.needsBlock && !this.top.type) {
    var block = this.textblockFromContext();
    if (block) { this.enterInner(block); }
  }
  if (this.findPlace(node)) {
    this.closeExtra();
    var top = this.top;
    top.applyPending(node.type);
    if (top.match) { top.match = top.match.matchType(node.type); }
    var marks = top.activeMarks;
    for (var i = 0; i < node.marks.length; i++)
      { if (!top.type || top.type.allowsMarkType(node.marks[i].type))
        { marks = node.marks[i].addToSet(marks); } }
    top.content.push(node.mark(marks));
    return true
  }
  return false
};

// : (NodeType, ?Object) → bool
// Try to start a node of the given type, adjusting the context when
// necessary.
ParseContext.prototype.enter = function enter (type, attrs, preserveWS) {
  var ok = this.findPlace(type.create(attrs));
  if (ok) { this.enterInner(type, attrs, true, preserveWS); }
  return ok
};

// Open a node of the given type
ParseContext.prototype.enterInner = function enterInner (type, attrs, solid, preserveWS) {
  this.closeExtra();
  var top = this.top;
  top.applyPending(type);
  top.match = top.match && top.match.matchType(type, attrs);
  var options = preserveWS == null ? top.options & ~OPT_OPEN_LEFT : wsOptionsFor(preserveWS);
  if ((top.options & OPT_OPEN_LEFT) && top.content.length == 0) { options |= OPT_OPEN_LEFT; }
  this.nodes.push(new NodeContext(type, attrs, top.activeMarks, top.pendingMarks, solid, null, options));
  this.open++;
};

// Make sure all nodes above this.open are finished and added to
// their parents
ParseContext.prototype.closeExtra = function closeExtra (openEnd) {
  var i = this.nodes.length - 1;
  if (i > this.open) {
    for (; i > this.open; i--) { this.nodes[i - 1].content.push(this.nodes[i].finish(openEnd)); }
    this.nodes.length = this.open + 1;
  }
};

ParseContext.prototype.finish = function finish () {
  this.open = 0;
  this.closeExtra(this.isOpen);
  return this.nodes[0].finish(this.isOpen || this.options.topOpen)
};

ParseContext.prototype.sync = function sync (to) {
  for (var i = this.open; i >= 0; i--) { if (this.nodes[i] == to) {
    this.open = i;
    return
  } }
};

prototypeAccessors$6.currentPos.get = function () {
  this.closeExtra();
  var pos = 0;
  for (var i = this.open; i >= 0; i--) {
    var content = this.nodes[i].content;
    for (var j = content.length - 1; j >= 0; j--)
      { pos += content[j].nodeSize; }
    if (i) { pos++; }
  }
  return pos
};

ParseContext.prototype.findAtPoint = function findAtPoint (parent, offset) {
  if (this.find) { for (var i = 0; i < this.find.length; i++) {
    if (this.find[i].node == parent && this.find[i].offset == offset)
      { this.find[i].pos = this.currentPos; }
  } }
};

ParseContext.prototype.findInside = function findInside (parent) {
  if (this.find) { for (var i = 0; i < this.find.length; i++) {
    if (this.find[i].pos == null && parent.nodeType == 1 && parent.contains(this.find[i].node))
      { this.find[i].pos = this.currentPos; }
  } }
};

ParseContext.prototype.findAround = function findAround (parent, content, before) {
  if (parent != content && this.find) { for (var i = 0; i < this.find.length; i++) {
    if (this.find[i].pos == null && parent.nodeType == 1 && parent.contains(this.find[i].node)) {
      var pos = content.compareDocumentPosition(this.find[i].node);
      if (pos & (before ? 2 : 4))
        { this.find[i].pos = this.currentPos; }
    }
  } }
};

ParseContext.prototype.findInText = function findInText (textNode) {
  if (this.find) { for (var i = 0; i < this.find.length; i++) {
    if (this.find[i].node == textNode)
      { this.find[i].pos = this.currentPos - (textNode.nodeValue.length - this.find[i].offset); }
  } }
};

// : (string) → bool
// Determines whether the given [context
// string](#ParseRule.context) matches this context.
ParseContext.prototype.matchesContext = function matchesContext (context) {
    var this$1$1 = this;

  if (context.indexOf("|") > -1)
    { return context.split(/\s*\|\s*/).some(this.matchesContext, this) }

  var parts = context.split("/");
  var option = this.options.context;
  var useRoot = !this.isOpen && (!option || option.parent.type == this.nodes[0].type);
  var minDepth = -(option ? option.depth + 1 : 0) + (useRoot ? 0 : 1);
  var match = function (i, depth) {
    for (; i >= 0; i--) {
      var part = parts[i];
      if (part == "") {
        if (i == parts.length - 1 || i == 0) { continue }
        for (; depth >= minDepth; depth--)
          { if (match(i - 1, depth)) { return true } }
        return false
      } else {
        var next = depth > 0 || (depth == 0 && useRoot) ? this$1$1.nodes[depth].type
            : option && depth >= minDepth ? option.node(depth - minDepth).type
            : null;
        if (!next || (next.name != part && next.groups.indexOf(part) == -1))
          { return false }
        depth--;
      }
    }
    return true
  };
  return match(parts.length - 1, this.open)
};

ParseContext.prototype.textblockFromContext = function textblockFromContext () {
  var $context = this.options.context;
  if ($context) { for (var d = $context.depth; d >= 0; d--) {
    var deflt = $context.node(d).contentMatchAt($context.indexAfter(d)).defaultType;
    if (deflt && deflt.isTextblock && deflt.defaultAttrs) { return deflt }
  } }
  for (var name in this.parser.schema.nodes) {
    var type = this.parser.schema.nodes[name];
    if (type.isTextblock && type.defaultAttrs) { return type }
  }
};

ParseContext.prototype.addPendingMark = function addPendingMark (mark) {
  var found = findSameMarkInSet(mark, this.top.pendingMarks);
  if (found) { this.top.stashMarks.push(found); }
  this.top.pendingMarks = mark.addToSet(this.top.pendingMarks);
};

ParseContext.prototype.removePendingMark = function removePendingMark (mark, upto) {
  for (var depth = this.open; depth >= 0; depth--) {
    var level = this.nodes[depth];
    var found = level.pendingMarks.lastIndexOf(mark);
    if (found > -1) {
      level.pendingMarks = mark.removeFromSet(level.pendingMarks);
    } else {
      level.activeMarks = mark.removeFromSet(level.activeMarks);
      var stashMark = level.popFromStashMark(mark);
      if (stashMark && level.type && level.type.allowsMarkType(stashMark.type))
        { level.activeMarks = stashMark.addToSet(level.activeMarks); }
    }
    if (level == upto) { break }
  }
};

Object.defineProperties( ParseContext.prototype, prototypeAccessors$6 );

// Kludge to work around directly nested list nodes produced by some
// tools and allowed by browsers to mean that the nested list is
// actually part of the list item above it.
function normalizeList(dom) {
  for (var child = dom.firstChild, prevItem = null; child; child = child.nextSibling) {
    var name = child.nodeType == 1 ? child.nodeName.toLowerCase() : null;
    if (name && listTags.hasOwnProperty(name) && prevItem) {
      prevItem.appendChild(child);
      child = prevItem;
    } else if (name == "li") {
      prevItem = child;
    } else if (name) {
      prevItem = null;
    }
  }
}

// : (string) → [string]
// Tokenize a style attribute into property/value pairs.
function parseStyles(style) {
  var re = /\s*([\w-]+)\s*:\s*([^;]+)/g, m, result = [];
  while (m = re.exec(style)) { result.push(m[1], m[2].trim()); }
  return result
}

// Used when finding a mark at the top level of a fragment parse.
// Checks whether it would be reasonable to apply a given mark type to
// a given node, by looking at the way the mark occurs in the schema.
function markMayApply(markType, nodeType) {
  var nodes = nodeType.schema.nodes;
  var loop = function ( name ) {
    var parent = nodes[name];
    if (!parent.allowsMarkType(markType)) { return }
    var seen = [], scan = function (match) {
      seen.push(match);
      for (var i = 0; i < match.edgeCount; i++) {
        var ref = match.edge(i);
        var type = ref.type;
        var next = ref.next;
        if (type == nodeType) { return true }
        if (seen.indexOf(next) < 0 && scan(next)) { return true }
      }
    };
    if (scan(parent.contentMatch)) { return { v: true } }
  };

  for (var name in nodes) {
    var returned = loop( name );

    if ( returned ) return returned.v;
  }
}

function findSameMarkInSet(mark, set) {
  for (var i = 0; i < set.length; i++) {
    if (mark.eq(set[i])) { return set[i] }
  }
}

// Mappable:: interface
// There are several things that positions can be mapped through.
// Such objects conform to this interface.
//
//   map:: (pos: number, assoc: ?number) → number
//   Map a position through this object. When given, `assoc` (should
//   be -1 or 1, defaults to 1) determines with which side the
//   position is associated, which determines in which direction to
//   move when a chunk of content is inserted at the mapped position.
//
//   mapResult:: (pos: number, assoc: ?number) → MapResult
//   Map a position, and return an object containing additional
//   information about the mapping. The result's `deleted` field tells
//   you whether the position was deleted (completely enclosed in a
//   replaced range) during the mapping. When content on only one side
//   is deleted, the position itself is only considered deleted when
//   `assoc` points in the direction of the deleted content.

// Recovery values encode a range index and an offset. They are
// represented as numbers, because tons of them will be created when
// mapping, for example, a large number of decorations. The number's
// lower 16 bits provide the index, the remaining bits the offset.
//
// Note: We intentionally don't use bit shift operators to en- and
// decode these, since those clip to 32 bits, which we might in rare
// cases want to overflow. A 64-bit float can represent 48-bit
// integers precisely.

var lower16 = 0xffff;
var factor16 = Math.pow(2, 16);

function makeRecover(index, offset) { return index + offset * factor16 }
function recoverIndex(value) { return value & lower16 }
function recoverOffset(value) { return (value - (value & lower16)) / factor16 }

// ::- An object representing a mapped position with extra
// information.
var MapResult = function MapResult(pos, deleted, recover) {
  if ( deleted === void 0 ) deleted = false;
  if ( recover === void 0 ) recover = null;

  // :: number The mapped version of the position.
  this.pos = pos;
  // :: bool Tells you whether the position was deleted, that is,
  // whether the step removed its surroundings from the document.
  this.deleted = deleted;
  this.recover = recover;
};

// :: class extends Mappable
// A map describing the deletions and insertions made by a step, which
// can be used to find the correspondence between positions in the
// pre-step version of a document and the same position in the
// post-step version.
var StepMap = function StepMap(ranges, inverted) {
  if ( inverted === void 0 ) inverted = false;

  this.ranges = ranges;
  this.inverted = inverted;
};

StepMap.prototype.recover = function recover (value) {
  var diff = 0, index = recoverIndex(value);
  if (!this.inverted) { for (var i = 0; i < index; i++)
    { diff += this.ranges[i * 3 + 2] - this.ranges[i * 3 + 1]; } }
  return this.ranges[index * 3] + diff + recoverOffset(value)
};

// : (number, ?number) → MapResult
StepMap.prototype.mapResult = function mapResult (pos, assoc) {
  if ( assoc === void 0 ) assoc = 1;
 return this._map(pos, assoc, false) };

// : (number, ?number) → number
StepMap.prototype.map = function map (pos, assoc) {
  if ( assoc === void 0 ) assoc = 1;
 return this._map(pos, assoc, true) };

StepMap.prototype._map = function _map (pos, assoc, simple) {
  var diff = 0, oldIndex = this.inverted ? 2 : 1, newIndex = this.inverted ? 1 : 2;
  for (var i = 0; i < this.ranges.length; i += 3) {
    var start = this.ranges[i] - (this.inverted ? diff : 0);
    if (start > pos) { break }
    var oldSize = this.ranges[i + oldIndex], newSize = this.ranges[i + newIndex], end = start + oldSize;
    if (pos <= end) {
      var side = !oldSize ? assoc : pos == start ? -1 : pos == end ? 1 : assoc;
      var result = start + diff + (side < 0 ? 0 : newSize);
      if (simple) { return result }
      var recover = pos == (assoc < 0 ? start : end) ? null : makeRecover(i / 3, pos - start);
      return new MapResult(result, assoc < 0 ? pos != start : pos != end, recover)
    }
    diff += newSize - oldSize;
  }
  return simple ? pos + diff : new MapResult(pos + diff)
};

StepMap.prototype.touches = function touches (pos, recover) {
  var diff = 0, index = recoverIndex(recover);
  var oldIndex = this.inverted ? 2 : 1, newIndex = this.inverted ? 1 : 2;
  for (var i = 0; i < this.ranges.length; i += 3) {
    var start = this.ranges[i] - (this.inverted ? diff : 0);
    if (start > pos) { break }
    var oldSize = this.ranges[i + oldIndex], end = start + oldSize;
    if (pos <= end && i == index * 3) { return true }
    diff += this.ranges[i + newIndex] - oldSize;
  }
  return false
};

// :: ((oldStart: number, oldEnd: number, newStart: number, newEnd: number))
// Calls the given function on each of the changed ranges included in
// this map.
StepMap.prototype.forEach = function forEach (f) {
  var oldIndex = this.inverted ? 2 : 1, newIndex = this.inverted ? 1 : 2;
  for (var i = 0, diff = 0; i < this.ranges.length; i += 3) {
    var start = this.ranges[i], oldStart = start - (this.inverted ? diff : 0), newStart = start + (this.inverted ? 0 : diff);
    var oldSize = this.ranges[i + oldIndex], newSize = this.ranges[i + newIndex];
    f(oldStart, oldStart + oldSize, newStart, newStart + newSize);
    diff += newSize - oldSize;
  }
};

// :: () → StepMap
// Create an inverted version of this map. The result can be used to
// map positions in the post-step document to the pre-step document.
StepMap.prototype.invert = function invert () {
  return new StepMap(this.ranges, !this.inverted)
};

StepMap.prototype.toString = function toString () {
  return (this.inverted ? "-" : "") + JSON.stringify(this.ranges)
};

// :: (n: number) → StepMap
// Create a map that moves all positions by offset `n` (which may be
// negative). This can be useful when applying steps meant for a
// sub-document to a larger document, or vice-versa.
StepMap.offset = function offset (n) {
  return n == 0 ? StepMap.empty : new StepMap(n < 0 ? [0, -n, 0] : [0, 0, n])
};

StepMap.empty = new StepMap([]);

// :: class extends Mappable
// A mapping represents a pipeline of zero or more [step
// maps](#transform.StepMap). It has special provisions for losslessly
// handling mapping positions through a series of steps in which some
// steps are inverted versions of earlier steps. (This comes up when
// ‘[rebasing](/docs/guide/#transform.rebasing)’ steps for
// collaboration or history management.)
var Mapping = function Mapping(maps, mirror, from, to) {
  // :: [StepMap]
  // The step maps in this mapping.
  this.maps = maps || [];
  // :: number
  // The starting position in the `maps` array, used when `map` or
  // `mapResult` is called.
  this.from = from || 0;
  // :: number
  // The end position in the `maps` array.
  this.to = to == null ? this.maps.length : to;
  this.mirror = mirror;
};

// :: (?number, ?number) → Mapping
// Create a mapping that maps only through a part of this one.
Mapping.prototype.slice = function slice (from, to) {
    if ( from === void 0 ) from = 0;
    if ( to === void 0 ) to = this.maps.length;

  return new Mapping(this.maps, this.mirror, from, to)
};

Mapping.prototype.copy = function copy () {
  return new Mapping(this.maps.slice(), this.mirror && this.mirror.slice(), this.from, this.to)
};

// :: (StepMap, ?number)
// Add a step map to the end of this mapping. If `mirrors` is
// given, it should be the index of the step map that is the mirror
// image of this one.
Mapping.prototype.appendMap = function appendMap (map, mirrors) {
  this.to = this.maps.push(map);
  if (mirrors != null) { this.setMirror(this.maps.length - 1, mirrors); }
};

// :: (Mapping)
// Add all the step maps in a given mapping to this one (preserving
// mirroring information).
Mapping.prototype.appendMapping = function appendMapping (mapping) {
  for (var i = 0, startSize = this.maps.length; i < mapping.maps.length; i++) {
    var mirr = mapping.getMirror(i);
    this.appendMap(mapping.maps[i], mirr != null && mirr < i ? startSize + mirr : null);
  }
};

// :: (number) → ?number
// Finds the offset of the step map that mirrors the map at the
// given offset, in this mapping (as per the second argument to
// `appendMap`).
Mapping.prototype.getMirror = function getMirror (n) {
  if (this.mirror) { for (var i = 0; i < this.mirror.length; i++)
    { if (this.mirror[i] == n) { return this.mirror[i + (i % 2 ? -1 : 1)] } } }
};

Mapping.prototype.setMirror = function setMirror (n, m) {
  if (!this.mirror) { this.mirror = []; }
  this.mirror.push(n, m);
};

// :: (Mapping)
// Append the inverse of the given mapping to this one.
Mapping.prototype.appendMappingInverted = function appendMappingInverted (mapping) {
  for (var i = mapping.maps.length - 1, totalSize = this.maps.length + mapping.maps.length; i >= 0; i--) {
    var mirr = mapping.getMirror(i);
    this.appendMap(mapping.maps[i].invert(), mirr != null && mirr > i ? totalSize - mirr - 1 : null);
  }
};

// :: () → Mapping
// Create an inverted version of this mapping.
Mapping.prototype.invert = function invert () {
  var inverse = new Mapping;
  inverse.appendMappingInverted(this);
  return inverse
};

// : (number, ?number) → number
// Map a position through this mapping.
Mapping.prototype.map = function map (pos, assoc) {
    if ( assoc === void 0 ) assoc = 1;

  if (this.mirror) { return this._map(pos, assoc, true) }
  for (var i = this.from; i < this.to; i++)
    { pos = this.maps[i].map(pos, assoc); }
  return pos
};

// : (number, ?number) → MapResult
// Map a position through this mapping, returning a mapping
// result.
Mapping.prototype.mapResult = function mapResult (pos, assoc) {
  if ( assoc === void 0 ) assoc = 1;
 return this._map(pos, assoc, false) };

Mapping.prototype._map = function _map (pos, assoc, simple) {
  var deleted = false;

  for (var i = this.from; i < this.to; i++) {
    var map = this.maps[i], result = map.mapResult(pos, assoc);
    if (result.recover != null) {
      var corr = this.getMirror(i);
      if (corr != null && corr > i && corr < this.to) {
        i = corr;
        pos = this.maps[corr].recover(result.recover);
        continue
      }
    }

    if (result.deleted) { deleted = true; }
    pos = result.pos;
  }

  return simple ? pos : new MapResult(pos, deleted)
};

function TransformError(message) {
  var err = Error.call(this, message);
  err.__proto__ = TransformError.prototype;
  return err
}

TransformError.prototype = Object.create(Error.prototype);
TransformError.prototype.constructor = TransformError;
TransformError.prototype.name = "TransformError";

// ::- Abstraction to build up and track an array of
// [steps](#transform.Step) representing a document transformation.
//
// Most transforming methods return the `Transform` object itself, so
// that they can be chained.
var Transform = function Transform(doc) {
  // :: Node
  // The current document (the result of applying the steps in the
  // transform).
  this.doc = doc;
  // :: [Step]
  // The steps in this transform.
  this.steps = [];
  // :: [Node]
  // The documents before each of the steps.
  this.docs = [];
  // :: Mapping
  // A mapping with the maps for each of the steps in this transform.
  this.mapping = new Mapping;
};

var prototypeAccessors$2 = { before: { configurable: true },docChanged: { configurable: true } };

// :: Node The starting document.
prototypeAccessors$2.before.get = function () { return this.docs.length ? this.docs[0] : this.doc };

// :: (step: Step) → this
// Apply a new step in this transform, saving the result. Throws an
// error when the step fails.
Transform.prototype.step = function step (object) {
  var result = this.maybeStep(object);
  if (result.failed) { throw new TransformError(result.failed) }
  return this
};

// :: (Step) → StepResult
// Try to apply a step in this transformation, ignoring it if it
// fails. Returns the step result.
Transform.prototype.maybeStep = function maybeStep (step) {
  var result = step.apply(this.doc);
  if (!result.failed) { this.addStep(step, result.doc); }
  return result
};

// :: bool
// True when the document has been changed (when there are any
// steps).
prototypeAccessors$2.docChanged.get = function () {
  return this.steps.length > 0
};

Transform.prototype.addStep = function addStep (step, doc) {
  this.docs.push(this.doc);
  this.steps.push(step);
  this.mapping.appendMap(step.getMap());
  this.doc = doc;
};

Object.defineProperties( Transform.prototype, prototypeAccessors$2 );

function mustOverride() { throw new Error("Override me") }

var stepsByID = Object.create(null);

// ::- A step object represents an atomic change. It generally applies
// only to the document it was created for, since the positions
// stored in it will only make sense for that document.
//
// New steps are defined by creating classes that extend `Step`,
// overriding the `apply`, `invert`, `map`, `getMap` and `fromJSON`
// methods, and registering your class with a unique
// JSON-serialization identifier using
// [`Step.jsonID`](#transform.Step^jsonID).
var Step = function Step () {};

Step.prototype.apply = function apply (_doc) { return mustOverride() };

// :: () → StepMap
// Get the step map that represents the changes made by this step,
// and which can be used to transform between positions in the old
// and the new document.
Step.prototype.getMap = function getMap () { return StepMap.empty };

// :: (doc: Node) → Step
// Create an inverted version of this step. Needs the document as it
// was before the step as argument.
Step.prototype.invert = function invert (_doc) { return mustOverride() };

// :: (mapping: Mappable) → ?Step
// Map this step through a mappable thing, returning either a
// version of that step with its positions adjusted, or `null` if
// the step was entirely deleted by the mapping.
Step.prototype.map = function map (_mapping) { return mustOverride() };

// :: (other: Step) → ?Step
// Try to merge this step with another one, to be applied directly
// after it. Returns the merged step when possible, null if the
// steps can't be merged.
Step.prototype.merge = function merge (_other) { return null };

// :: () → Object
// Create a JSON-serializeable representation of this step. When
// defining this for a custom subclass, make sure the result object
// includes the step type's [JSON id](#transform.Step^jsonID) under
// the `stepType` property.
Step.prototype.toJSON = function toJSON () { return mustOverride() };

// :: (Schema, Object) → Step
// Deserialize a step from its JSON representation. Will call
// through to the step class' own implementation of this method.
Step.fromJSON = function fromJSON (schema, json) {
  if (!json || !json.stepType) { throw new RangeError("Invalid input for Step.fromJSON") }
  var type = stepsByID[json.stepType];
  if (!type) { throw new RangeError(("No step type " + (json.stepType) + " defined")) }
  return type.fromJSON(schema, json)
};

// :: (string, constructor<Step>)
// To be able to serialize steps to JSON, each step needs a string
// ID to attach to its JSON representation. Use this method to
// register an ID for your step classes. Try to pick something
// that's unlikely to clash with steps from other modules.
Step.jsonID = function jsonID (id, stepClass) {
  if (id in stepsByID) { throw new RangeError("Duplicate use of step JSON ID " + id) }
  stepsByID[id] = stepClass;
  stepClass.prototype.jsonID = id;
  return stepClass
};

// ::- The result of [applying](#transform.Step.apply) a step. Contains either a
// new document or a failure value.
var StepResult = function StepResult(doc, failed) {
  // :: ?Node The transformed document.
  this.doc = doc;
  // :: ?string Text providing information about a failed step.
  this.failed = failed;
};

// :: (Node) → StepResult
// Create a successful step result.
StepResult.ok = function ok (doc) { return new StepResult(doc, null) };

// :: (string) → StepResult
// Create a failed step result.
StepResult.fail = function fail (message) { return new StepResult(null, message) };

// :: (Node, number, number, Slice) → StepResult
// Call [`Node.replace`](#model.Node.replace) with the given
// arguments. Create a successful result if it succeeds, and a
// failed one if it throws a `ReplaceError`.
StepResult.fromReplace = function fromReplace (doc, from, to, slice) {
  try {
    return StepResult.ok(doc.replace(from, to, slice))
  } catch (e) {
    if (e instanceof ReplaceError) { return StepResult.fail(e.message) }
    throw e
  }
};

// ::- Replace a part of the document with a slice of new content.
var ReplaceStep = /*@__PURE__*/(function (Step) {
  function ReplaceStep(from, to, slice, structure) {
    Step.call(this);
    // :: number
    // The start position of the replaced range.
    this.from = from;
    // :: number
    // The end position of the replaced range.
    this.to = to;
    // :: Slice
    // The slice to insert.
    this.slice = slice;
    this.structure = !!structure;
  }

  if ( Step ) ReplaceStep.__proto__ = Step;
  ReplaceStep.prototype = Object.create( Step && Step.prototype );
  ReplaceStep.prototype.constructor = ReplaceStep;

  ReplaceStep.prototype.apply = function apply (doc) {
    if (this.structure && contentBetween(doc, this.from, this.to))
      { return StepResult.fail("Structure replace would overwrite content") }
    return StepResult.fromReplace(doc, this.from, this.to, this.slice)
  };

  ReplaceStep.prototype.getMap = function getMap () {
    return new StepMap([this.from, this.to - this.from, this.slice.size])
  };

  ReplaceStep.prototype.invert = function invert (doc) {
    return new ReplaceStep(this.from, this.from + this.slice.size, doc.slice(this.from, this.to))
  };

  ReplaceStep.prototype.map = function map (mapping) {
    var from = mapping.mapResult(this.from, 1), to = mapping.mapResult(this.to, -1);
    if (from.deleted && to.deleted) { return null }
    return new ReplaceStep(from.pos, Math.max(from.pos, to.pos), this.slice)
  };

  ReplaceStep.prototype.merge = function merge (other) {
    if (!(other instanceof ReplaceStep) || other.structure || this.structure) { return null }

    if (this.from + this.slice.size == other.from && !this.slice.openEnd && !other.slice.openStart) {
      var slice = this.slice.size + other.slice.size == 0 ? Slice.empty
          : new Slice(this.slice.content.append(other.slice.content), this.slice.openStart, other.slice.openEnd);
      return new ReplaceStep(this.from, this.to + (other.to - other.from), slice, this.structure)
    } else if (other.to == this.from && !this.slice.openStart && !other.slice.openEnd) {
      var slice$1 = this.slice.size + other.slice.size == 0 ? Slice.empty
          : new Slice(other.slice.content.append(this.slice.content), other.slice.openStart, this.slice.openEnd);
      return new ReplaceStep(other.from, this.to, slice$1, this.structure)
    } else {
      return null
    }
  };

  ReplaceStep.prototype.toJSON = function toJSON () {
    var json = {stepType: "replace", from: this.from, to: this.to};
    if (this.slice.size) { json.slice = this.slice.toJSON(); }
    if (this.structure) { json.structure = true; }
    return json
  };

  ReplaceStep.fromJSON = function fromJSON (schema, json) {
    if (typeof json.from != "number" || typeof json.to != "number")
      { throw new RangeError("Invalid input for ReplaceStep.fromJSON") }
    return new ReplaceStep(json.from, json.to, Slice.fromJSON(schema, json.slice), !!json.structure)
  };

  return ReplaceStep;
}(Step));

Step.jsonID("replace", ReplaceStep);

// ::- Replace a part of the document with a slice of content, but
// preserve a range of the replaced content by moving it into the
// slice.
var ReplaceAroundStep = /*@__PURE__*/(function (Step) {
  function ReplaceAroundStep(from, to, gapFrom, gapTo, slice, insert, structure) {
    Step.call(this);
    // :: number
    // The start position of the replaced range.
    this.from = from;
    // :: number
    // The end position of the replaced range.
    this.to = to;
    // :: number
    // The start of preserved range.
    this.gapFrom = gapFrom;
    // :: number
    // The end of preserved range.
    this.gapTo = gapTo;
    // :: Slice
    // The slice to insert.
    this.slice = slice;
    // :: number
    // The position in the slice where the preserved range should be
    // inserted.
    this.insert = insert;
    this.structure = !!structure;
  }

  if ( Step ) ReplaceAroundStep.__proto__ = Step;
  ReplaceAroundStep.prototype = Object.create( Step && Step.prototype );
  ReplaceAroundStep.prototype.constructor = ReplaceAroundStep;

  ReplaceAroundStep.prototype.apply = function apply (doc) {
    if (this.structure && (contentBetween(doc, this.from, this.gapFrom) ||
                           contentBetween(doc, this.gapTo, this.to)))
      { return StepResult.fail("Structure gap-replace would overwrite content") }

    var gap = doc.slice(this.gapFrom, this.gapTo);
    if (gap.openStart || gap.openEnd)
      { return StepResult.fail("Gap is not a flat range") }
    var inserted = this.slice.insertAt(this.insert, gap.content);
    if (!inserted) { return StepResult.fail("Content does not fit in gap") }
    return StepResult.fromReplace(doc, this.from, this.to, inserted)
  };

  ReplaceAroundStep.prototype.getMap = function getMap () {
    return new StepMap([this.from, this.gapFrom - this.from, this.insert,
                        this.gapTo, this.to - this.gapTo, this.slice.size - this.insert])
  };

  ReplaceAroundStep.prototype.invert = function invert (doc) {
    var gap = this.gapTo - this.gapFrom;
    return new ReplaceAroundStep(this.from, this.from + this.slice.size + gap,
                                 this.from + this.insert, this.from + this.insert + gap,
                                 doc.slice(this.from, this.to).removeBetween(this.gapFrom - this.from, this.gapTo - this.from),
                                 this.gapFrom - this.from, this.structure)
  };

  ReplaceAroundStep.prototype.map = function map (mapping) {
    var from = mapping.mapResult(this.from, 1), to = mapping.mapResult(this.to, -1);
    var gapFrom = mapping.map(this.gapFrom, -1), gapTo = mapping.map(this.gapTo, 1);
    if ((from.deleted && to.deleted) || gapFrom < from.pos || gapTo > to.pos) { return null }
    return new ReplaceAroundStep(from.pos, to.pos, gapFrom, gapTo, this.slice, this.insert, this.structure)
  };

  ReplaceAroundStep.prototype.toJSON = function toJSON () {
    var json = {stepType: "replaceAround", from: this.from, to: this.to,
                gapFrom: this.gapFrom, gapTo: this.gapTo, insert: this.insert};
    if (this.slice.size) { json.slice = this.slice.toJSON(); }
    if (this.structure) { json.structure = true; }
    return json
  };

  ReplaceAroundStep.fromJSON = function fromJSON (schema, json) {
    if (typeof json.from != "number" || typeof json.to != "number" ||
        typeof json.gapFrom != "number" || typeof json.gapTo != "number" || typeof json.insert != "number")
      { throw new RangeError("Invalid input for ReplaceAroundStep.fromJSON") }
    return new ReplaceAroundStep(json.from, json.to, json.gapFrom, json.gapTo,
                                 Slice.fromJSON(schema, json.slice), json.insert, !!json.structure)
  };

  return ReplaceAroundStep;
}(Step));

Step.jsonID("replaceAround", ReplaceAroundStep);

function contentBetween(doc, from, to) {
  var $from = doc.resolve(from), dist = to - from, depth = $from.depth;
  while (dist > 0 && depth > 0 && $from.indexAfter(depth) == $from.node(depth).childCount) {
    depth--;
    dist--;
  }
  if (dist > 0) {
    var next = $from.node(depth).maybeChild($from.indexAfter(depth));
    while (dist > 0) {
      if (!next || next.isLeaf) { return true }
      next = next.firstChild;
      dist--;
    }
  }
  return false
}

// :: (NodeRange, number) → this
// Split the content in the given range off from its parent, if there
// is sibling content before or after it, and move it up the tree to
// the depth specified by `target`. You'll probably want to use
// [`liftTarget`](#transform.liftTarget) to compute `target`, to make
// sure the lift is valid.
Transform.prototype.lift = function(range, target) {
  var $from = range.$from;
  var $to = range.$to;
  var depth = range.depth;

  var gapStart = $from.before(depth + 1), gapEnd = $to.after(depth + 1);
  var start = gapStart, end = gapEnd;

  var before = Fragment.empty, openStart = 0;
  for (var d = depth, splitting = false; d > target; d--)
    { if (splitting || $from.index(d) > 0) {
      splitting = true;
      before = Fragment.from($from.node(d).copy(before));
      openStart++;
    } else {
      start--;
    } }
  var after = Fragment.empty, openEnd = 0;
  for (var d$1 = depth, splitting$1 = false; d$1 > target; d$1--)
    { if (splitting$1 || $to.after(d$1 + 1) < $to.end(d$1)) {
      splitting$1 = true;
      after = Fragment.from($to.node(d$1).copy(after));
      openEnd++;
    } else {
      end++;
    } }

  return this.step(new ReplaceAroundStep(start, end, gapStart, gapEnd,
                                         new Slice(before.append(after), openStart, openEnd),
                                         before.size - openStart, true))
};

// :: (NodeRange, [{type: NodeType, attrs: ?Object}]) → this
// Wrap the given [range](#model.NodeRange) in the given set of wrappers.
// The wrappers are assumed to be valid in this position, and should
// probably be computed with [`findWrapping`](#transform.findWrapping).
Transform.prototype.wrap = function(range, wrappers) {
  var content = Fragment.empty;
  for (var i = wrappers.length - 1; i >= 0; i--)
    { content = Fragment.from(wrappers[i].type.create(wrappers[i].attrs, content)); }

  var start = range.start, end = range.end;
  return this.step(new ReplaceAroundStep(start, end, start, end, new Slice(content, 0, 0), wrappers.length, true))
};

// :: (number, ?number, NodeType, ?Object) → this
// Set the type of all textblocks (partly) between `from` and `to` to
// the given node type with the given attributes.
Transform.prototype.setBlockType = function(from, to, type, attrs) {
  var this$1$1 = this;
  if ( to === void 0 ) to = from;

  if (!type.isTextblock) { throw new RangeError("Type given to setBlockType should be a textblock") }
  var mapFrom = this.steps.length;
  this.doc.nodesBetween(from, to, function (node, pos) {
    if (node.isTextblock && !node.hasMarkup(type, attrs) && canChangeType(this$1$1.doc, this$1$1.mapping.slice(mapFrom).map(pos), type)) {
      // Ensure all markup that isn't allowed in the new node type is cleared
      this$1$1.clearIncompatible(this$1$1.mapping.slice(mapFrom).map(pos, 1), type);
      var mapping = this$1$1.mapping.slice(mapFrom);
      var startM = mapping.map(pos, 1), endM = mapping.map(pos + node.nodeSize, 1);
      this$1$1.step(new ReplaceAroundStep(startM, endM, startM + 1, endM - 1,
                                      new Slice(Fragment.from(type.create(attrs, null, node.marks)), 0, 0), 1, true));
      return false
    }
  });
  return this
};

function canChangeType(doc, pos, type) {
  var $pos = doc.resolve(pos), index = $pos.index();
  return $pos.parent.canReplaceWith(index, index + 1, type)
}

// :: (number, ?NodeType, ?Object, ?[Mark]) → this
// Change the type, attributes, and/or marks of the node at `pos`.
// When `type` isn't given, the existing node type is preserved,
Transform.prototype.setNodeMarkup = function(pos, type, attrs, marks) {
  var node = this.doc.nodeAt(pos);
  if (!node) { throw new RangeError("No node at given position") }
  if (!type) { type = node.type; }
  var newNode = type.create(attrs, null, marks || node.marks);
  if (node.isLeaf)
    { return this.replaceWith(pos, pos + node.nodeSize, newNode) }

  if (!type.validContent(node.content))
    { throw new RangeError("Invalid content for node type " + type.name) }

  return this.step(new ReplaceAroundStep(pos, pos + node.nodeSize, pos + 1, pos + node.nodeSize - 1,
                                         new Slice(Fragment.from(newNode), 0, 0), 1, true))
};

// :: (number, ?number, ?[?{type: NodeType, attrs: ?Object}]) → this
// Split the node at the given position, and optionally, if `depth` is
// greater than one, any number of nodes above that. By default, the
// parts split off will inherit the node type of the original node.
// This can be changed by passing an array of types and attributes to
// use after the split.
Transform.prototype.split = function(pos, depth, typesAfter) {
  if ( depth === void 0 ) depth = 1;

  var $pos = this.doc.resolve(pos), before = Fragment.empty, after = Fragment.empty;
  for (var d = $pos.depth, e = $pos.depth - depth, i = depth - 1; d > e; d--, i--) {
    before = Fragment.from($pos.node(d).copy(before));
    var typeAfter = typesAfter && typesAfter[i];
    after = Fragment.from(typeAfter ? typeAfter.type.create(typeAfter.attrs, after) : $pos.node(d).copy(after));
  }
  return this.step(new ReplaceStep(pos, pos, new Slice(before.append(after), depth, depth), true))
};

// :: (number, ?number) → this
// Join the blocks around the given position. If depth is 2, their
// last and first siblings are also joined, and so on.
Transform.prototype.join = function(pos, depth) {
  if ( depth === void 0 ) depth = 1;

  var step = new ReplaceStep(pos - depth, pos + depth, Slice.empty, true);
  return this.step(step)
};

// :: (Node, number, NodeType) → ?number
// Try to find a point where a node of the given type can be inserted
// near `pos`, by searching up the node hierarchy when `pos` itself
// isn't a valid place but is at the start or end of a node. Return
// null if no position was found.
function insertPoint(doc, pos, nodeType) {
  var $pos = doc.resolve(pos);
  if ($pos.parent.canReplaceWith($pos.index(), $pos.index(), nodeType)) { return pos }

  if ($pos.parentOffset == 0)
    { for (var d = $pos.depth - 1; d >= 0; d--) {
      var index = $pos.index(d);
      if ($pos.node(d).canReplaceWith(index, index, nodeType)) { return $pos.before(d + 1) }
      if (index > 0) { return null }
    } }
  if ($pos.parentOffset == $pos.parent.content.size)
    { for (var d$1 = $pos.depth - 1; d$1 >= 0; d$1--) {
      var index$1 = $pos.indexAfter(d$1);
      if ($pos.node(d$1).canReplaceWith(index$1, index$1, nodeType)) { return $pos.after(d$1 + 1) }
      if (index$1 < $pos.node(d$1).childCount) { return null }
    } }
}

function mapFragment(fragment, f, parent) {
  var mapped = [];
  for (var i = 0; i < fragment.childCount; i++) {
    var child = fragment.child(i);
    if (child.content.size) { child = child.copy(mapFragment(child.content, f, child)); }
    if (child.isInline) { child = f(child, parent, i); }
    mapped.push(child);
  }
  return Fragment.fromArray(mapped)
}

// ::- Add a mark to all inline content between two positions.
var AddMarkStep = /*@__PURE__*/(function (Step) {
  function AddMarkStep(from, to, mark) {
    Step.call(this);
    // :: number
    // The start of the marked range.
    this.from = from;
    // :: number
    // The end of the marked range.
    this.to = to;
    // :: Mark
    // The mark to add.
    this.mark = mark;
  }

  if ( Step ) AddMarkStep.__proto__ = Step;
  AddMarkStep.prototype = Object.create( Step && Step.prototype );
  AddMarkStep.prototype.constructor = AddMarkStep;

  AddMarkStep.prototype.apply = function apply (doc) {
    var this$1$1 = this;

    var oldSlice = doc.slice(this.from, this.to), $from = doc.resolve(this.from);
    var parent = $from.node($from.sharedDepth(this.to));
    var slice = new Slice(mapFragment(oldSlice.content, function (node, parent) {
      if (!node.isAtom || !parent.type.allowsMarkType(this$1$1.mark.type)) { return node }
      return node.mark(this$1$1.mark.addToSet(node.marks))
    }, parent), oldSlice.openStart, oldSlice.openEnd);
    return StepResult.fromReplace(doc, this.from, this.to, slice)
  };

  AddMarkStep.prototype.invert = function invert () {
    return new RemoveMarkStep(this.from, this.to, this.mark)
  };

  AddMarkStep.prototype.map = function map (mapping) {
    var from = mapping.mapResult(this.from, 1), to = mapping.mapResult(this.to, -1);
    if (from.deleted && to.deleted || from.pos >= to.pos) { return null }
    return new AddMarkStep(from.pos, to.pos, this.mark)
  };

  AddMarkStep.prototype.merge = function merge (other) {
    if (other instanceof AddMarkStep &&
        other.mark.eq(this.mark) &&
        this.from <= other.to && this.to >= other.from)
      { return new AddMarkStep(Math.min(this.from, other.from),
                             Math.max(this.to, other.to), this.mark) }
  };

  AddMarkStep.prototype.toJSON = function toJSON () {
    return {stepType: "addMark", mark: this.mark.toJSON(),
            from: this.from, to: this.to}
  };

  AddMarkStep.fromJSON = function fromJSON (schema, json) {
    if (typeof json.from != "number" || typeof json.to != "number")
      { throw new RangeError("Invalid input for AddMarkStep.fromJSON") }
    return new AddMarkStep(json.from, json.to, schema.markFromJSON(json.mark))
  };

  return AddMarkStep;
}(Step));

Step.jsonID("addMark", AddMarkStep);

// ::- Remove a mark from all inline content between two positions.
var RemoveMarkStep = /*@__PURE__*/(function (Step) {
  function RemoveMarkStep(from, to, mark) {
    Step.call(this);
    // :: number
    // The start of the unmarked range.
    this.from = from;
    // :: number
    // The end of the unmarked range.
    this.to = to;
    // :: Mark
    // The mark to remove.
    this.mark = mark;
  }

  if ( Step ) RemoveMarkStep.__proto__ = Step;
  RemoveMarkStep.prototype = Object.create( Step && Step.prototype );
  RemoveMarkStep.prototype.constructor = RemoveMarkStep;

  RemoveMarkStep.prototype.apply = function apply (doc) {
    var this$1$1 = this;

    var oldSlice = doc.slice(this.from, this.to);
    var slice = new Slice(mapFragment(oldSlice.content, function (node) {
      return node.mark(this$1$1.mark.removeFromSet(node.marks))
    }), oldSlice.openStart, oldSlice.openEnd);
    return StepResult.fromReplace(doc, this.from, this.to, slice)
  };

  RemoveMarkStep.prototype.invert = function invert () {
    return new AddMarkStep(this.from, this.to, this.mark)
  };

  RemoveMarkStep.prototype.map = function map (mapping) {
    var from = mapping.mapResult(this.from, 1), to = mapping.mapResult(this.to, -1);
    if (from.deleted && to.deleted || from.pos >= to.pos) { return null }
    return new RemoveMarkStep(from.pos, to.pos, this.mark)
  };

  RemoveMarkStep.prototype.merge = function merge (other) {
    if (other instanceof RemoveMarkStep &&
        other.mark.eq(this.mark) &&
        this.from <= other.to && this.to >= other.from)
      { return new RemoveMarkStep(Math.min(this.from, other.from),
                                Math.max(this.to, other.to), this.mark) }
  };

  RemoveMarkStep.prototype.toJSON = function toJSON () {
    return {stepType: "removeMark", mark: this.mark.toJSON(),
            from: this.from, to: this.to}
  };

  RemoveMarkStep.fromJSON = function fromJSON (schema, json) {
    if (typeof json.from != "number" || typeof json.to != "number")
      { throw new RangeError("Invalid input for RemoveMarkStep.fromJSON") }
    return new RemoveMarkStep(json.from, json.to, schema.markFromJSON(json.mark))
  };

  return RemoveMarkStep;
}(Step));

Step.jsonID("removeMark", RemoveMarkStep);

// :: (number, number, Mark) → this
// Add the given mark to the inline content between `from` and `to`.
Transform.prototype.addMark = function(from, to, mark) {
  var this$1$1 = this;

  var removed = [], added = [], removing = null, adding = null;
  this.doc.nodesBetween(from, to, function (node, pos, parent) {
    if (!node.isInline) { return }
    var marks = node.marks;
    if (!mark.isInSet(marks) && parent.type.allowsMarkType(mark.type)) {
      var start = Math.max(pos, from), end = Math.min(pos + node.nodeSize, to);
      var newSet = mark.addToSet(marks);

      for (var i = 0; i < marks.length; i++) {
        if (!marks[i].isInSet(newSet)) {
          if (removing && removing.to == start && removing.mark.eq(marks[i]))
            { removing.to = end; }
          else
            { removed.push(removing = new RemoveMarkStep(start, end, marks[i])); }
        }
      }

      if (adding && adding.to == start)
        { adding.to = end; }
      else
        { added.push(adding = new AddMarkStep(start, end, mark)); }
    }
  });

  removed.forEach(function (s) { return this$1$1.step(s); });
  added.forEach(function (s) { return this$1$1.step(s); });
  return this
};

// :: (number, number, ?union<Mark, MarkType>) → this
// Remove marks from inline nodes between `from` and `to`. When `mark`
// is a single mark, remove precisely that mark. When it is a mark type,
// remove all marks of that type. When it is null, remove all marks of
// any type.
Transform.prototype.removeMark = function(from, to, mark) {
  var this$1$1 = this;
  if ( mark === void 0 ) mark = null;

  var matched = [], step = 0;
  this.doc.nodesBetween(from, to, function (node, pos) {
    if (!node.isInline) { return }
    step++;
    var toRemove = null;
    if (mark instanceof MarkType) {
      var set = node.marks, found;
      while (found = mark.isInSet(set)) {
(toRemove || (toRemove = [])).push(found);
        set = found.removeFromSet(set);
      }
    } else if (mark) {
      if (mark.isInSet(node.marks)) { toRemove = [mark]; }
    } else {
      toRemove = node.marks;
    }
    if (toRemove && toRemove.length) {
      var end = Math.min(pos + node.nodeSize, to);
      for (var i = 0; i < toRemove.length; i++) {
        var style = toRemove[i], found$1 = (void 0);
        for (var j = 0; j < matched.length; j++) {
          var m = matched[j];
          if (m.step == step - 1 && style.eq(matched[j].style)) { found$1 = m; }
        }
        if (found$1) {
          found$1.to = end;
          found$1.step = step;
        } else {
          matched.push({style: style, from: Math.max(pos, from), to: end, step: step});
        }
      }
    }
  });
  matched.forEach(function (m) { return this$1$1.step(new RemoveMarkStep(m.from, m.to, m.style)); });
  return this
};

// :: (number, NodeType, ?ContentMatch) → this
// Removes all marks and nodes from the content of the node at `pos`
// that don't match the given new parent node type. Accepts an
// optional starting [content match](#model.ContentMatch) as third
// argument.
Transform.prototype.clearIncompatible = function(pos, parentType, match) {
  if ( match === void 0 ) match = parentType.contentMatch;

  var node = this.doc.nodeAt(pos);
  var delSteps = [], cur = pos + 1;
  for (var i = 0; i < node.childCount; i++) {
    var child = node.child(i), end = cur + child.nodeSize;
    var allowed = match.matchType(child.type, child.attrs);
    if (!allowed) {
      delSteps.push(new ReplaceStep(cur, end, Slice.empty));
    } else {
      match = allowed;
      for (var j = 0; j < child.marks.length; j++) { if (!parentType.allowsMarkType(child.marks[j].type))
        { this.step(new RemoveMarkStep(cur, end, child.marks[j])); } }
    }
    cur = end;
  }
  if (!match.validEnd) {
    var fill = match.fillBefore(Fragment.empty, true);
    this.replace(cur, cur, new Slice(fill, 0, 0));
  }
  for (var i$1 = delSteps.length - 1; i$1 >= 0; i$1--) { this.step(delSteps[i$1]); }
  return this
};

// :: (Node, number, ?number, ?Slice) → ?Step
// ‘Fit’ a slice into a given position in the document, producing a
// [step](#transform.Step) that inserts it. Will return null if
// there's no meaningful way to insert the slice here, or inserting it
// would be a no-op (an empty slice over an empty range).
function replaceStep(doc, from, to, slice) {
  if ( to === void 0 ) to = from;
  if ( slice === void 0 ) slice = Slice.empty;

  if (from == to && !slice.size) { return null }

  var $from = doc.resolve(from), $to = doc.resolve(to);
  // Optimization -- avoid work if it's obvious that it's not needed.
  if (fitsTrivially($from, $to, slice)) { return new ReplaceStep(from, to, slice) }
  return new Fitter($from, $to, slice).fit()
}

// :: (number, ?number, ?Slice) → this
// Replace the part of the document between `from` and `to` with the
// given `slice`.
Transform.prototype.replace = function(from, to, slice) {
  if ( to === void 0 ) to = from;
  if ( slice === void 0 ) slice = Slice.empty;

  var step = replaceStep(this.doc, from, to, slice);
  if (step) { this.step(step); }
  return this
};

// :: (number, number, union<Fragment, Node, [Node]>) → this
// Replace the given range with the given content, which may be a
// fragment, node, or array of nodes.
Transform.prototype.replaceWith = function(from, to, content) {
  return this.replace(from, to, new Slice(Fragment.from(content), 0, 0))
};

// :: (number, number) → this
// Delete the content between the given positions.
Transform.prototype.delete = function(from, to) {
  return this.replace(from, to, Slice.empty)
};

// :: (number, union<Fragment, Node, [Node]>) → this
// Insert the given content at the given position.
Transform.prototype.insert = function(pos, content) {
  return this.replaceWith(pos, pos, content)
};

function fitsTrivially($from, $to, slice) {
  return !slice.openStart && !slice.openEnd && $from.start() == $to.start() &&
    $from.parent.canReplace($from.index(), $to.index(), slice.content)
}

// Algorithm for 'placing' the elements of a slice into a gap:
//
// We consider the content of each node that is open to the left to be
// independently placeable. I.e. in <p("foo"), p("bar")>, when the
// paragraph on the left is open, "foo" can be placed (somewhere on
// the left side of the replacement gap) independently from p("bar").
//
// This class tracks the state of the placement progress in the
// following properties:
//
//  - `frontier` holds a stack of `{type, match}` objects that
//    represent the open side of the replacement. It starts at
//    `$from`, then moves forward as content is placed, and is finally
//    reconciled with `$to`.
//
//  - `unplaced` is a slice that represents the content that hasn't
//    been placed yet.
//
//  - `placed` is a fragment of placed content. Its open-start value
//    is implicit in `$from`, and its open-end value in `frontier`.
var Fitter = function Fitter($from, $to, slice) {
  this.$to = $to;
  this.$from = $from;
  this.unplaced = slice;

  this.frontier = [];
  for (var i = 0; i <= $from.depth; i++) {
    var node = $from.node(i);
    this.frontier.push({
      type: node.type,
      match: node.contentMatchAt($from.indexAfter(i))
    });
  }

  this.placed = Fragment.empty;
  for (var i$1 = $from.depth; i$1 > 0; i$1--)
    { this.placed = Fragment.from($from.node(i$1).copy(this.placed)); }
};

var prototypeAccessors$1$1 = { depth: { configurable: true } };

prototypeAccessors$1$1.depth.get = function () { return this.frontier.length - 1 };

Fitter.prototype.fit = function fit () {
  // As long as there's unplaced content, try to place some of it.
  // If that fails, either increase the open score of the unplaced
  // slice, or drop nodes from it, and then try again.
  while (this.unplaced.size) {
    var fit = this.findFittable();
    if (fit) { this.placeNodes(fit); }
    else { this.openMore() || this.dropNode(); }
  }
  // When there's inline content directly after the frontier _and_
  // directly after `this.$to`, we must generate a `ReplaceAround`
  // step that pulls that content into the node after the frontier.
  // That means the fitting must be done to the end of the textblock
  // node after `this.$to`, not `this.$to` itself.
  var moveInline = this.mustMoveInline(), placedSize = this.placed.size - this.depth - this.$from.depth;
  var $from = this.$from, $to = this.close(moveInline < 0 ? this.$to : $from.doc.resolve(moveInline));
  if (!$to) { return null }

  // If closing to `$to` succeeded, create a step
  var content = this.placed, openStart = $from.depth, openEnd = $to.depth;
  while (openStart && openEnd && content.childCount == 1) { // Normalize by dropping open parent nodes
    content = content.firstChild.content;
    openStart--; openEnd--;
  }
  var slice = new Slice(content, openStart, openEnd);
  if (moveInline > -1)
    { return new ReplaceAroundStep($from.pos, moveInline, this.$to.pos, this.$to.end(), slice, placedSize) }
  if (slice.size || $from.pos != this.$to.pos) // Don't generate no-op steps
    { return new ReplaceStep($from.pos, $to.pos, slice) }
};

// Find a position on the start spine of `this.unplaced` that has
// content that can be moved somewhere on the frontier. Returns two
// depths, one for the slice and one for the frontier.
Fitter.prototype.findFittable = function findFittable () {
  // Only try wrapping nodes (pass 2) after finding a place without
  // wrapping failed.
  for (var pass = 1; pass <= 2; pass++) {
    for (var sliceDepth = this.unplaced.openStart; sliceDepth >= 0; sliceDepth--) {
      var fragment = (void 0), parent = (void 0);
      if (sliceDepth) {
        parent = contentAt(this.unplaced.content, sliceDepth - 1).firstChild;
        fragment = parent.content;
      } else {
        fragment = this.unplaced.content;
      }
      var first = fragment.firstChild;
      for (var frontierDepth = this.depth; frontierDepth >= 0; frontierDepth--) {
        var ref = this.frontier[frontierDepth];
          var type = ref.type;
          var match = ref.match;
          var wrap = (void 0), inject = (void 0);
        // In pass 1, if the next node matches, or there is no next
        // node but the parents look compatible, we've found a
        // place.
        if (pass == 1 && (first ? match.matchType(first.type) || (inject = match.fillBefore(Fragment.from(first), false))
                          : type.compatibleContent(parent.type)))
          { return {sliceDepth: sliceDepth, frontierDepth: frontierDepth, parent: parent, inject: inject} }
        // In pass 2, look for a set of wrapping nodes that make
        // `first` fit here.
        else if (pass == 2 && first && (wrap = match.findWrapping(first.type)))
          { return {sliceDepth: sliceDepth, frontierDepth: frontierDepth, parent: parent, wrap: wrap} }
        // Don't continue looking further up if the parent node
        // would fit here.
        if (parent && match.matchType(parent.type)) { break }
      }
    }
  }
};

Fitter.prototype.openMore = function openMore () {
  var ref = this.unplaced;
    var content = ref.content;
    var openStart = ref.openStart;
    var openEnd = ref.openEnd;
  var inner = contentAt(content, openStart);
  if (!inner.childCount || inner.firstChild.isLeaf) { return false }
  this.unplaced = new Slice(content, openStart + 1,
                            Math.max(openEnd, inner.size + openStart >= content.size - openEnd ? openStart + 1 : 0));
  return true
};

Fitter.prototype.dropNode = function dropNode () {
  var ref = this.unplaced;
    var content = ref.content;
    var openStart = ref.openStart;
    var openEnd = ref.openEnd;
  var inner = contentAt(content, openStart);
  if (inner.childCount <= 1 && openStart > 0) {
    var openAtEnd = content.size - openStart <= openStart + inner.size;
    this.unplaced = new Slice(dropFromFragment(content, openStart - 1, 1), openStart - 1,
                              openAtEnd ? openStart - 1 : openEnd);
  } else {
    this.unplaced = new Slice(dropFromFragment(content, openStart, 1), openStart, openEnd);
  }
};

// : ({sliceDepth: number, frontierDepth: number, parent: ?Node, wrap: ?[NodeType], inject: ?Fragment})
// Move content from the unplaced slice at `sliceDepth` to the
// frontier node at `frontierDepth`. Close that frontier node when
// applicable.
Fitter.prototype.placeNodes = function placeNodes (ref) {
    var sliceDepth = ref.sliceDepth;
    var frontierDepth = ref.frontierDepth;
    var parent = ref.parent;
    var inject = ref.inject;
    var wrap = ref.wrap;

  while (this.depth > frontierDepth) { this.closeFrontierNode(); }
  if (wrap) { for (var i = 0; i < wrap.length; i++) { this.openFrontierNode(wrap[i]); } }

  var slice = this.unplaced, fragment = parent ? parent.content : slice.content;
  var openStart = slice.openStart - sliceDepth;
  var taken = 0, add = [];
  var ref$1 = this.frontier[frontierDepth];
    var match = ref$1.match;
    var type = ref$1.type;
  if (inject) {
    for (var i$1 = 0; i$1 < inject.childCount; i$1++) { add.push(inject.child(i$1)); }
    match = match.matchFragment(inject);
  }
  // Computes the amount of (end) open nodes at the end of the
  // fragment. When 0, the parent is open, but no more. When
  // negative, nothing is open.
  var openEndCount = (fragment.size + sliceDepth) - (slice.content.size - slice.openEnd);
  // Scan over the fragment, fitting as many child nodes as
  // possible.
  while (taken < fragment.childCount) {
    var next = fragment.child(taken), matches = match.matchType(next.type);
    if (!matches) { break }
    taken++;
    if (taken > 1 || openStart == 0 || next.content.size) { // Drop empty open nodes
      match = matches;
      add.push(closeNodeStart(next.mark(type.allowedMarks(next.marks)), taken == 1 ? openStart : 0,
                              taken == fragment.childCount ? openEndCount : -1));
    }
  }
  var toEnd = taken == fragment.childCount;
  if (!toEnd) { openEndCount = -1; }

  this.placed = addToFragment(this.placed, frontierDepth, Fragment.from(add));
  this.frontier[frontierDepth].match = match;

  // If the parent types match, and the entire node was moved, and
  // it's not open, close this frontier node right away.
  if (toEnd && openEndCount < 0 && parent && parent.type == this.frontier[this.depth].type && this.frontier.length > 1)
    { this.closeFrontierNode(); }

  // Add new frontier nodes for any open nodes at the end.
  for (var i$2 = 0, cur = fragment; i$2 < openEndCount; i$2++) {
    var node = cur.lastChild;
    this.frontier.push({type: node.type, match: node.contentMatchAt(node.childCount)});
    cur = node.content;
  }

  // Update `this.unplaced`. Drop the entire node from which we
  // placed it we got to its end, otherwise just drop the placed
  // nodes.
  this.unplaced = !toEnd ? new Slice(dropFromFragment(slice.content, sliceDepth, taken), slice.openStart, slice.openEnd)
    : sliceDepth == 0 ? Slice.empty
    : new Slice(dropFromFragment(slice.content, sliceDepth - 1, 1),
                sliceDepth - 1, openEndCount < 0 ? slice.openEnd : sliceDepth - 1);
};

Fitter.prototype.mustMoveInline = function mustMoveInline () {
  if (!this.$to.parent.isTextblock || this.$to.end() == this.$to.pos) { return -1 }
  var top = this.frontier[this.depth], level;
  if (!top.type.isTextblock || !contentAfterFits(this.$to, this.$to.depth, top.type, top.match, false) ||
      (this.$to.depth == this.depth && (level = this.findCloseLevel(this.$to)) && level.depth == this.depth)) { return -1 }

  var ref = this.$to;
    var depth = ref.depth;
    var after = this.$to.after(depth);
  while (depth > 1 && after == this.$to.end(--depth)) { ++after; }
  return after
};

Fitter.prototype.findCloseLevel = function findCloseLevel ($to) {
  scan: for (var i = Math.min(this.depth, $to.depth); i >= 0; i--) {
    var ref = this.frontier[i];
      var match = ref.match;
      var type = ref.type;
    var dropInner = i < $to.depth && $to.end(i + 1) == $to.pos + ($to.depth - (i + 1));
    var fit = contentAfterFits($to, i, type, match, dropInner);
    if (!fit) { continue }
    for (var d = i - 1; d >= 0; d--) {
      var ref$1 = this.frontier[d];
        var match$1 = ref$1.match;
        var type$1 = ref$1.type;
      var matches = contentAfterFits($to, d, type$1, match$1, true);
      if (!matches || matches.childCount) { continue scan }
    }
    return {depth: i, fit: fit, move: dropInner ? $to.doc.resolve($to.after(i + 1)) : $to}
  }
};

Fitter.prototype.close = function close ($to) {
  var close = this.findCloseLevel($to);
  if (!close) { return null }

  while (this.depth > close.depth) { this.closeFrontierNode(); }
  if (close.fit.childCount) { this.placed = addToFragment(this.placed, close.depth, close.fit); }
  $to = close.move;
  for (var d = close.depth + 1; d <= $to.depth; d++) {
    var node = $to.node(d), add = node.type.contentMatch.fillBefore(node.content, true, $to.index(d));
    this.openFrontierNode(node.type, node.attrs, add);
  }
  return $to
};

Fitter.prototype.openFrontierNode = function openFrontierNode (type, attrs, content) {
  var top = this.frontier[this.depth];
  top.match = top.match.matchType(type);
  this.placed = addToFragment(this.placed, this.depth, Fragment.from(type.create(attrs, content)));
  this.frontier.push({type: type, match: type.contentMatch});
};

Fitter.prototype.closeFrontierNode = function closeFrontierNode () {
  var open = this.frontier.pop();
  var add = open.match.fillBefore(Fragment.empty, true);
  if (add.childCount) { this.placed = addToFragment(this.placed, this.frontier.length, add); }
};

Object.defineProperties( Fitter.prototype, prototypeAccessors$1$1 );

function dropFromFragment(fragment, depth, count) {
  if (depth == 0) { return fragment.cutByIndex(count) }
  return fragment.replaceChild(0, fragment.firstChild.copy(dropFromFragment(fragment.firstChild.content, depth - 1, count)))
}

function addToFragment(fragment, depth, content) {
  if (depth == 0) { return fragment.append(content) }
  return fragment.replaceChild(fragment.childCount - 1,
                               fragment.lastChild.copy(addToFragment(fragment.lastChild.content, depth - 1, content)))
}

function contentAt(fragment, depth) {
  for (var i = 0; i < depth; i++) { fragment = fragment.firstChild.content; }
  return fragment
}

function closeNodeStart(node, openStart, openEnd) {
  if (openStart <= 0) { return node }
  var frag = node.content;
  if (openStart > 1)
    { frag = frag.replaceChild(0, closeNodeStart(frag.firstChild, openStart - 1, frag.childCount == 1 ? openEnd - 1 : 0)); }
  if (openStart > 0) {
    frag = node.type.contentMatch.fillBefore(frag).append(frag);
    if (openEnd <= 0) { frag = frag.append(node.type.contentMatch.matchFragment(frag).fillBefore(Fragment.empty, true)); }
  }
  return node.copy(frag)
}

function contentAfterFits($to, depth, type, match, open) {
  var node = $to.node(depth), index = open ? $to.indexAfter(depth) : $to.index(depth);
  if (index == node.childCount && !type.compatibleContent(node.type)) { return null }
  var fit = match.fillBefore(node.content, true, index);
  return fit && !invalidMarks(type, node.content, index) ? fit : null
}

function invalidMarks(type, fragment, start) {
  for (var i = start; i < fragment.childCount; i++)
    { if (!type.allowsMarks(fragment.child(i).marks)) { return true } }
  return false
}

// :: (number, number, Slice) → this
// Replace a range of the document with a given slice, using `from`,
// `to`, and the slice's [`openStart`](#model.Slice.openStart) property
// as hints, rather than fixed start and end points. This method may
// grow the replaced area or close open nodes in the slice in order to
// get a fit that is more in line with WYSIWYG expectations, by
// dropping fully covered parent nodes of the replaced region when
// they are marked [non-defining](#model.NodeSpec.defining), or
// including an open parent node from the slice that _is_ marked as
// [defining](#model.NodeSpec.defining).
//
// This is the method, for example, to handle paste. The similar
// [`replace`](#transform.Transform.replace) method is a more
// primitive tool which will _not_ move the start and end of its given
// range, and is useful in situations where you need more precise
// control over what happens.
Transform.prototype.replaceRange = function(from, to, slice) {
  if (!slice.size) { return this.deleteRange(from, to) }

  var $from = this.doc.resolve(from), $to = this.doc.resolve(to);
  if (fitsTrivially($from, $to, slice))
    { return this.step(new ReplaceStep(from, to, slice)) }

  var targetDepths = coveredDepths($from, this.doc.resolve(to));
  // Can't replace the whole document, so remove 0 if it's present
  if (targetDepths[targetDepths.length - 1] == 0) { targetDepths.pop(); }
  // Negative numbers represent not expansion over the whole node at
  // that depth, but replacing from $from.before(-D) to $to.pos.
  var preferredTarget = -($from.depth + 1);
  targetDepths.unshift(preferredTarget);
  // This loop picks a preferred target depth, if one of the covering
  // depths is not outside of a defining node, and adds negative
  // depths for any depth that has $from at its start and does not
  // cross a defining node.
  for (var d = $from.depth, pos = $from.pos - 1; d > 0; d--, pos--) {
    var spec = $from.node(d).type.spec;
    if (spec.defining || spec.isolating) { break }
    if (targetDepths.indexOf(d) > -1) { preferredTarget = d; }
    else if ($from.before(d) == pos) { targetDepths.splice(1, 0, -d); }
  }
  // Try to fit each possible depth of the slice into each possible
  // target depth, starting with the preferred depths.
  var preferredTargetIndex = targetDepths.indexOf(preferredTarget);

  var leftNodes = [], preferredDepth = slice.openStart;
  for (var content = slice.content, i = 0;; i++) {
    var node = content.firstChild;
    leftNodes.push(node);
    if (i == slice.openStart) { break }
    content = node.content;
  }
  // Back up if the node directly above openStart, or the node above
  // that separated only by a non-defining textblock node, is defining.
  if (preferredDepth > 0 && leftNodes[preferredDepth - 1].type.spec.defining &&
      $from.node(preferredTargetIndex).type != leftNodes[preferredDepth - 1].type)
    { preferredDepth -= 1; }
  else if (preferredDepth >= 2 && leftNodes[preferredDepth - 1].isTextblock && leftNodes[preferredDepth - 2].type.spec.defining &&
           $from.node(preferredTargetIndex).type != leftNodes[preferredDepth - 2].type)
    { preferredDepth -= 2; }

  for (var j = slice.openStart; j >= 0; j--) {
    var openDepth = (j + preferredDepth + 1) % (slice.openStart + 1);
    var insert = leftNodes[openDepth];
    if (!insert) { continue }
    for (var i$1 = 0; i$1 < targetDepths.length; i$1++) {
      // Loop over possible expansion levels, starting with the
      // preferred one
      var targetDepth = targetDepths[(i$1 + preferredTargetIndex) % targetDepths.length], expand = true;
      if (targetDepth < 0) { expand = false; targetDepth = -targetDepth; }
      var parent = $from.node(targetDepth - 1), index = $from.index(targetDepth - 1);
      if (parent.canReplaceWith(index, index, insert.type, insert.marks))
        { return this.replace($from.before(targetDepth), expand ? $to.after(targetDepth) : to,
                            new Slice(closeFragment(slice.content, 0, slice.openStart, openDepth),
                                      openDepth, slice.openEnd)) }
    }
  }

  var startSteps = this.steps.length;
  for (var i$2 = targetDepths.length - 1; i$2 >= 0; i$2--) {
    this.replace(from, to, slice);
    if (this.steps.length > startSteps) { break }
    var depth = targetDepths[i$2];
    if (depth < 0) { continue }
    from = $from.before(depth); to = $to.after(depth);
  }
  return this
};

function closeFragment(fragment, depth, oldOpen, newOpen, parent) {
  if (depth < oldOpen) {
    var first = fragment.firstChild;
    fragment = fragment.replaceChild(0, first.copy(closeFragment(first.content, depth + 1, oldOpen, newOpen, first)));
  }
  if (depth > newOpen) {
    var match = parent.contentMatchAt(0);
    var start = match.fillBefore(fragment).append(fragment);
    fragment = start.append(match.matchFragment(start).fillBefore(Fragment.empty, true));
  }
  return fragment
}

// :: (number, number, Node) → this
// Replace the given range with a node, but use `from` and `to` as
// hints, rather than precise positions. When from and to are the same
// and are at the start or end of a parent node in which the given
// node doesn't fit, this method may _move_ them out towards a parent
// that does allow the given node to be placed. When the given range
// completely covers a parent node, this method may completely replace
// that parent node.
Transform.prototype.replaceRangeWith = function(from, to, node) {
  if (!node.isInline && from == to && this.doc.resolve(from).parent.content.size) {
    var point = insertPoint(this.doc, from, node.type);
    if (point != null) { from = to = point; }
  }
  return this.replaceRange(from, to, new Slice(Fragment.from(node), 0, 0))
};

// :: (number, number) → this
// Delete the given range, expanding it to cover fully covered
// parent nodes until a valid replace is found.
Transform.prototype.deleteRange = function(from, to) {
  var $from = this.doc.resolve(from), $to = this.doc.resolve(to);
  var covered = coveredDepths($from, $to);
  for (var i = 0; i < covered.length; i++) {
    var depth = covered[i], last = i == covered.length - 1;
    if ((last && depth == 0) || $from.node(depth).type.contentMatch.validEnd)
      { return this.delete($from.start(depth), $to.end(depth)) }
    if (depth > 0 && (last || $from.node(depth - 1).canReplace($from.index(depth - 1), $to.indexAfter(depth - 1))))
      { return this.delete($from.before(depth), $to.after(depth)) }
  }
  for (var d = 1; d <= $from.depth && d <= $to.depth; d++) {
    if (from - $from.start(d) == $from.depth - d && to > $from.end(d) && $to.end(d) - to != $to.depth - d)
      { return this.delete($from.before(d), to) }
  }
  return this.delete(from, to)
};

// : (ResolvedPos, ResolvedPos) → [number]
// Returns an array of all depths for which $from - $to spans the
// whole content of the nodes at that depth.
function coveredDepths($from, $to) {
  var result = [], minDepth = Math.min($from.depth, $to.depth);
  for (var d = minDepth; d >= 0; d--) {
    var start = $from.start(d);
    if (start < $from.pos - ($from.depth - d) ||
        $to.end(d) > $to.pos + ($to.depth - d) ||
        $from.node(d).type.spec.isolating ||
        $to.node(d).type.spec.isolating) { break }
    if (start == $to.start(d)) { result.push(d); }
  }
  return result
}

var classesById = Object.create(null);

// ::- Superclass for editor selections. Every selection type should
// extend this. Should not be instantiated directly.
var Selection = function Selection($anchor, $head, ranges) {
  // :: [SelectionRange]
  // The ranges covered by the selection.
  this.ranges = ranges || [new SelectionRange($anchor.min($head), $anchor.max($head))];
  // :: ResolvedPos
  // The resolved anchor of the selection (the side that stays in
  // place when the selection is modified).
  this.$anchor = $anchor;
  // :: ResolvedPos
  // The resolved head of the selection (the side that moves when
  // the selection is modified).
  this.$head = $head;
};

var prototypeAccessors = { anchor: { configurable: true },head: { configurable: true },from: { configurable: true },to: { configurable: true },$from: { configurable: true },$to: { configurable: true },empty: { configurable: true } };

// :: number
// The selection's anchor, as an unresolved position.
prototypeAccessors.anchor.get = function () { return this.$anchor.pos };

// :: number
// The selection's head.
prototypeAccessors.head.get = function () { return this.$head.pos };

// :: number
// The lower bound of the selection's main range.
prototypeAccessors.from.get = function () { return this.$from.pos };

// :: number
// The upper bound of the selection's main range.
prototypeAccessors.to.get = function () { return this.$to.pos };

// :: ResolvedPos
// The resolved lowerbound of the selection's main range.
prototypeAccessors.$from.get = function () {
  return this.ranges[0].$from
};

// :: ResolvedPos
// The resolved upper bound of the selection's main range.
prototypeAccessors.$to.get = function () {
  return this.ranges[0].$to
};

// :: bool
// Indicates whether the selection contains any content.
prototypeAccessors.empty.get = function () {
  var ranges = this.ranges;
  for (var i = 0; i < ranges.length; i++)
    { if (ranges[i].$from.pos != ranges[i].$to.pos) { return false } }
  return true
};

// eq:: (Selection) → bool
// Test whether the selection is the same as another selection.

// map:: (doc: Node, mapping: Mappable) → Selection
// Map this selection through a [mappable](#transform.Mappable) thing. `doc`
// should be the new document to which we are mapping.

// :: () → Slice
// Get the content of this selection as a slice.
Selection.prototype.content = function content () {
  return this.$from.node(0).slice(this.from, this.to, true)
};

// :: (Transaction, ?Slice)
// Replace the selection with a slice or, if no slice is given,
// delete the selection. Will append to the given transaction.
Selection.prototype.replace = function replace (tr, content) {
    if ( content === void 0 ) content = Slice.empty;

  // Put the new selection at the position after the inserted
  // content. When that ended in an inline node, search backwards,
  // to get the position after that node. If not, search forward.
  var lastNode = content.content.lastChild, lastParent = null;
  for (var i = 0; i < content.openEnd; i++) {
    lastParent = lastNode;
    lastNode = lastNode.lastChild;
  }

  var mapFrom = tr.steps.length, ranges = this.ranges;
  for (var i$1 = 0; i$1 < ranges.length; i$1++) {
    var ref = ranges[i$1];
      var $from = ref.$from;
      var $to = ref.$to;
      var mapping = tr.mapping.slice(mapFrom);
    tr.replaceRange(mapping.map($from.pos), mapping.map($to.pos), i$1 ? Slice.empty : content);
    if (i$1 == 0)
      { selectionToInsertionEnd(tr, mapFrom, (lastNode ? lastNode.isInline : lastParent && lastParent.isTextblock) ? -1 : 1); }
  }
};

// :: (Transaction, Node)
// Replace the selection with the given node, appending the changes
// to the given transaction.
Selection.prototype.replaceWith = function replaceWith (tr, node) {
  var mapFrom = tr.steps.length, ranges = this.ranges;
  for (var i = 0; i < ranges.length; i++) {
    var ref = ranges[i];
      var $from = ref.$from;
      var $to = ref.$to;
      var mapping = tr.mapping.slice(mapFrom);
    var from = mapping.map($from.pos), to = mapping.map($to.pos);
    if (i) {
      tr.deleteRange(from, to);
    } else {
      tr.replaceRangeWith(from, to, node);
      selectionToInsertionEnd(tr, mapFrom, node.isInline ? -1 : 1);
    }
  }
};

// toJSON:: () → Object
// Convert the selection to a JSON representation. When implementing
// this for a custom selection class, make sure to give the object a
// `type` property whose value matches the ID under which you
// [registered](#state.Selection^jsonID) your class.

// :: (ResolvedPos, number, ?bool) → ?Selection
// Find a valid cursor or leaf node selection starting at the given
// position and searching back if `dir` is negative, and forward if
// positive. When `textOnly` is true, only consider cursor
// selections. Will return null when no valid selection position is
// found.
Selection.findFrom = function findFrom ($pos, dir, textOnly) {
  var inner = $pos.parent.inlineContent ? new TextSelection($pos)
      : findSelectionIn($pos.node(0), $pos.parent, $pos.pos, $pos.index(), dir, textOnly);
  if (inner) { return inner }

  for (var depth = $pos.depth - 1; depth >= 0; depth--) {
    var found = dir < 0
        ? findSelectionIn($pos.node(0), $pos.node(depth), $pos.before(depth + 1), $pos.index(depth), dir, textOnly)
        : findSelectionIn($pos.node(0), $pos.node(depth), $pos.after(depth + 1), $pos.index(depth) + 1, dir, textOnly);
    if (found) { return found }
  }
};

// :: (ResolvedPos, ?number) → Selection
// Find a valid cursor or leaf node selection near the given
// position. Searches forward first by default, but if `bias` is
// negative, it will search backwards first.
Selection.near = function near ($pos, bias) {
    if ( bias === void 0 ) bias = 1;

  return this.findFrom($pos, bias) || this.findFrom($pos, -bias) || new AllSelection($pos.node(0))
};

// :: (Node) → Selection
// Find the cursor or leaf node selection closest to the start of
// the given document. Will return an
// [`AllSelection`](#state.AllSelection) if no valid position
// exists.
Selection.atStart = function atStart (doc) {
  return findSelectionIn(doc, doc, 0, 0, 1) || new AllSelection(doc)
};

// :: (Node) → Selection
// Find the cursor or leaf node selection closest to the end of the
// given document.
Selection.atEnd = function atEnd (doc) {
  return findSelectionIn(doc, doc, doc.content.size, doc.childCount, -1) || new AllSelection(doc)
};

// :: (Node, Object) → Selection
// Deserialize the JSON representation of a selection. Must be
// implemented for custom classes (as a static class method).
Selection.fromJSON = function fromJSON (doc, json) {
  if (!json || !json.type) { throw new RangeError("Invalid input for Selection.fromJSON") }
  var cls = classesById[json.type];
  if (!cls) { throw new RangeError(("No selection type " + (json.type) + " defined")) }
  return cls.fromJSON(doc, json)
};

// :: (string, constructor<Selection>)
// To be able to deserialize selections from JSON, custom selection
// classes must register themselves with an ID string, so that they
// can be disambiguated. Try to pick something that's unlikely to
// clash with classes from other modules.
Selection.jsonID = function jsonID (id, selectionClass) {
  if (id in classesById) { throw new RangeError("Duplicate use of selection JSON ID " + id) }
  classesById[id] = selectionClass;
  selectionClass.prototype.jsonID = id;
  return selectionClass
};

// :: () → SelectionBookmark
// Get a [bookmark](#state.SelectionBookmark) for this selection,
// which is a value that can be mapped without having access to a
// current document, and later resolved to a real selection for a
// given document again. (This is used mostly by the history to
// track and restore old selections.) The default implementation of
// this method just converts the selection to a text selection and
// returns the bookmark for that.
Selection.prototype.getBookmark = function getBookmark () {
  return TextSelection.between(this.$anchor, this.$head).getBookmark()
};

Object.defineProperties( Selection.prototype, prototypeAccessors );

// :: bool
// Controls whether, when a selection of this type is active in the
// browser, the selected range should be visible to the user. Defaults
// to `true`.
Selection.prototype.visible = true;

// SelectionBookmark:: interface
// A lightweight, document-independent representation of a selection.
// You can define a custom bookmark type for a custom selection class
// to make the history handle it well.
//
//   map:: (mapping: Mapping) → SelectionBookmark
//   Map the bookmark through a set of changes.
//
//   resolve:: (doc: Node) → Selection
//   Resolve the bookmark to a real selection again. This may need to
//   do some error checking and may fall back to a default (usually
//   [`TextSelection.between`](#state.TextSelection^between)) if
//   mapping made the bookmark invalid.

// ::- Represents a selected range in a document.
var SelectionRange = function SelectionRange($from, $to) {
  // :: ResolvedPos
  // The lower bound of the range.
  this.$from = $from;
  // :: ResolvedPos
  // The upper bound of the range.
  this.$to = $to;
};

// ::- A text selection represents a classical editor selection, with
// a head (the moving side) and anchor (immobile side), both of which
// point into textblock nodes. It can be empty (a regular cursor
// position).
var TextSelection = /*@__PURE__*/(function (Selection) {
  function TextSelection($anchor, $head) {
    if ( $head === void 0 ) $head = $anchor;

    Selection.call(this, $anchor, $head);
  }

  if ( Selection ) TextSelection.__proto__ = Selection;
  TextSelection.prototype = Object.create( Selection && Selection.prototype );
  TextSelection.prototype.constructor = TextSelection;

  var prototypeAccessors$1 = { $cursor: { configurable: true } };

  // :: ?ResolvedPos
  // Returns a resolved position if this is a cursor selection (an
  // empty text selection), and null otherwise.
  prototypeAccessors$1.$cursor.get = function () { return this.$anchor.pos == this.$head.pos ? this.$head : null };

  TextSelection.prototype.map = function map (doc, mapping) {
    var $head = doc.resolve(mapping.map(this.head));
    if (!$head.parent.inlineContent) { return Selection.near($head) }
    var $anchor = doc.resolve(mapping.map(this.anchor));
    return new TextSelection($anchor.parent.inlineContent ? $anchor : $head, $head)
  };

  TextSelection.prototype.replace = function replace (tr, content) {
    if ( content === void 0 ) content = Slice.empty;

    Selection.prototype.replace.call(this, tr, content);
    if (content == Slice.empty) {
      var marks = this.$from.marksAcross(this.$to);
      if (marks) { tr.ensureMarks(marks); }
    }
  };

  TextSelection.prototype.eq = function eq (other) {
    return other instanceof TextSelection && other.anchor == this.anchor && other.head == this.head
  };

  TextSelection.prototype.getBookmark = function getBookmark () {
    return new TextBookmark(this.anchor, this.head)
  };

  TextSelection.prototype.toJSON = function toJSON () {
    return {type: "text", anchor: this.anchor, head: this.head}
  };

  TextSelection.fromJSON = function fromJSON (doc, json) {
    if (typeof json.anchor != "number" || typeof json.head != "number")
      { throw new RangeError("Invalid input for TextSelection.fromJSON") }
    return new TextSelection(doc.resolve(json.anchor), doc.resolve(json.head))
  };

  // :: (Node, number, ?number) → TextSelection
  // Create a text selection from non-resolved positions.
  TextSelection.create = function create (doc, anchor, head) {
    if ( head === void 0 ) head = anchor;

    var $anchor = doc.resolve(anchor);
    return new this($anchor, head == anchor ? $anchor : doc.resolve(head))
  };

  // :: (ResolvedPos, ResolvedPos, ?number) → Selection
  // Return a text selection that spans the given positions or, if
  // they aren't text positions, find a text selection near them.
  // `bias` determines whether the method searches forward (default)
  // or backwards (negative number) first. Will fall back to calling
  // [`Selection.near`](#state.Selection^near) when the document
  // doesn't contain a valid text position.
  TextSelection.between = function between ($anchor, $head, bias) {
    var dPos = $anchor.pos - $head.pos;
    if (!bias || dPos) { bias = dPos >= 0 ? 1 : -1; }
    if (!$head.parent.inlineContent) {
      var found = Selection.findFrom($head, bias, true) || Selection.findFrom($head, -bias, true);
      if (found) { $head = found.$head; }
      else { return Selection.near($head, bias) }
    }
    if (!$anchor.parent.inlineContent) {
      if (dPos == 0) {
        $anchor = $head;
      } else {
        $anchor = (Selection.findFrom($anchor, -bias, true) || Selection.findFrom($anchor, bias, true)).$anchor;
        if (($anchor.pos < $head.pos) != (dPos < 0)) { $anchor = $head; }
      }
    }
    return new TextSelection($anchor, $head)
  };

  Object.defineProperties( TextSelection.prototype, prototypeAccessors$1 );

  return TextSelection;
}(Selection));

Selection.jsonID("text", TextSelection);

var TextBookmark = function TextBookmark(anchor, head) {
  this.anchor = anchor;
  this.head = head;
};
TextBookmark.prototype.map = function map (mapping) {
  return new TextBookmark(mapping.map(this.anchor), mapping.map(this.head))
};
TextBookmark.prototype.resolve = function resolve (doc) {
  return TextSelection.between(doc.resolve(this.anchor), doc.resolve(this.head))
};

// ::- A node selection is a selection that points at a single node.
// All nodes marked [selectable](#model.NodeSpec.selectable) can be
// the target of a node selection. In such a selection, `from` and
// `to` point directly before and after the selected node, `anchor`
// equals `from`, and `head` equals `to`..
var NodeSelection = /*@__PURE__*/(function (Selection) {
  function NodeSelection($pos) {
    var node = $pos.nodeAfter;
    var $end = $pos.node(0).resolve($pos.pos + node.nodeSize);
    Selection.call(this, $pos, $end);
    // :: Node The selected node.
    this.node = node;
  }

  if ( Selection ) NodeSelection.__proto__ = Selection;
  NodeSelection.prototype = Object.create( Selection && Selection.prototype );
  NodeSelection.prototype.constructor = NodeSelection;

  NodeSelection.prototype.map = function map (doc, mapping) {
    var ref = mapping.mapResult(this.anchor);
    var deleted = ref.deleted;
    var pos = ref.pos;
    var $pos = doc.resolve(pos);
    if (deleted) { return Selection.near($pos) }
    return new NodeSelection($pos)
  };

  NodeSelection.prototype.content = function content () {
    return new Slice(Fragment.from(this.node), 0, 0)
  };

  NodeSelection.prototype.eq = function eq (other) {
    return other instanceof NodeSelection && other.anchor == this.anchor
  };

  NodeSelection.prototype.toJSON = function toJSON () {
    return {type: "node", anchor: this.anchor}
  };

  NodeSelection.prototype.getBookmark = function getBookmark () { return new NodeBookmark(this.anchor) };

  NodeSelection.fromJSON = function fromJSON (doc, json) {
    if (typeof json.anchor != "number")
      { throw new RangeError("Invalid input for NodeSelection.fromJSON") }
    return new NodeSelection(doc.resolve(json.anchor))
  };

  // :: (Node, number) → NodeSelection
  // Create a node selection from non-resolved positions.
  NodeSelection.create = function create (doc, from) {
    return new this(doc.resolve(from))
  };

  // :: (Node) → bool
  // Determines whether the given node may be selected as a node
  // selection.
  NodeSelection.isSelectable = function isSelectable (node) {
    return !node.isText && node.type.spec.selectable !== false
  };

  return NodeSelection;
}(Selection));

NodeSelection.prototype.visible = false;

Selection.jsonID("node", NodeSelection);

var NodeBookmark = function NodeBookmark(anchor) {
  this.anchor = anchor;
};
NodeBookmark.prototype.map = function map (mapping) {
  var ref = mapping.mapResult(this.anchor);
    var deleted = ref.deleted;
    var pos = ref.pos;
  return deleted ? new TextBookmark(pos, pos) : new NodeBookmark(pos)
};
NodeBookmark.prototype.resolve = function resolve (doc) {
  var $pos = doc.resolve(this.anchor), node = $pos.nodeAfter;
  if (node && NodeSelection.isSelectable(node)) { return new NodeSelection($pos) }
  return Selection.near($pos)
};

// ::- A selection type that represents selecting the whole document
// (which can not necessarily be expressed with a text selection, when
// there are for example leaf block nodes at the start or end of the
// document).
var AllSelection = /*@__PURE__*/(function (Selection) {
  function AllSelection(doc) {
    Selection.call(this, doc.resolve(0), doc.resolve(doc.content.size));
  }

  if ( Selection ) AllSelection.__proto__ = Selection;
  AllSelection.prototype = Object.create( Selection && Selection.prototype );
  AllSelection.prototype.constructor = AllSelection;

  AllSelection.prototype.replace = function replace (tr, content) {
    if ( content === void 0 ) content = Slice.empty;

    if (content == Slice.empty) {
      tr.delete(0, tr.doc.content.size);
      var sel = Selection.atStart(tr.doc);
      if (!sel.eq(tr.selection)) { tr.setSelection(sel); }
    } else {
      Selection.prototype.replace.call(this, tr, content);
    }
  };

  AllSelection.prototype.toJSON = function toJSON () { return {type: "all"} };

  AllSelection.fromJSON = function fromJSON (doc) { return new AllSelection(doc) };

  AllSelection.prototype.map = function map (doc) { return new AllSelection(doc) };

  AllSelection.prototype.eq = function eq (other) { return other instanceof AllSelection };

  AllSelection.prototype.getBookmark = function getBookmark () { return AllBookmark };

  return AllSelection;
}(Selection));

Selection.jsonID("all", AllSelection);

var AllBookmark = {
  map: function map() { return this },
  resolve: function resolve(doc) { return new AllSelection(doc) }
};

// FIXME we'll need some awareness of text direction when scanning for selections

// Try to find a selection inside the given node. `pos` points at the
// position where the search starts. When `text` is true, only return
// text selections.
function findSelectionIn(doc, node, pos, index, dir, text) {
  if (node.inlineContent) { return TextSelection.create(doc, pos) }
  for (var i = index - (dir > 0 ? 0 : 1); dir > 0 ? i < node.childCount : i >= 0; i += dir) {
    var child = node.child(i);
    if (!child.isAtom) {
      var inner = findSelectionIn(doc, child, pos + dir, dir < 0 ? child.childCount : 0, dir, text);
      if (inner) { return inner }
    } else if (!text && NodeSelection.isSelectable(child)) {
      return NodeSelection.create(doc, pos - (dir < 0 ? child.nodeSize : 0))
    }
    pos += child.nodeSize * dir;
  }
}

function selectionToInsertionEnd(tr, startLen, bias) {
  var last = tr.steps.length - 1;
  if (last < startLen) { return }
  var step = tr.steps[last];
  if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) { return }
  var map = tr.mapping.maps[last], end;
  map.forEach(function (_from, _to, _newFrom, newTo) { if (end == null) { end = newTo; } });
  tr.setSelection(Selection.near(tr.doc.resolve(end), bias));
}

var UPDATED_SEL = 1, UPDATED_MARKS = 2, UPDATED_SCROLL = 4;

// ::- An editor state transaction, which can be applied to a state to
// create an updated state. Use
// [`EditorState.tr`](#state.EditorState.tr) to create an instance.
//
// Transactions track changes to the document (they are a subclass of
// [`Transform`](#transform.Transform)), but also other state changes,
// like selection updates and adjustments of the set of [stored
// marks](#state.EditorState.storedMarks). In addition, you can store
// metadata properties in a transaction, which are extra pieces of
// information that client code or plugins can use to describe what a
// transacion represents, so that they can update their [own
// state](#state.StateField) accordingly.
//
// The [editor view](#view.EditorView) uses a few metadata properties:
// it will attach a property `"pointer"` with the value `true` to
// selection transactions directly caused by mouse or touch input, and
// a `"uiEvent"` property of that may be `"paste"`, `"cut"`, or `"drop"`.
var Transaction = /*@__PURE__*/(function (Transform) {
  function Transaction(state) {
    Transform.call(this, state.doc);
    // :: number
    // The timestamp associated with this transaction, in the same
    // format as `Date.now()`.
    this.time = Date.now();
    this.curSelection = state.selection;
    // The step count for which the current selection is valid.
    this.curSelectionFor = 0;
    // :: ?[Mark]
    // The stored marks set by this transaction, if any.
    this.storedMarks = state.storedMarks;
    // Bitfield to track which aspects of the state were updated by
    // this transaction.
    this.updated = 0;
    // Object used to store metadata properties for the transaction.
    this.meta = Object.create(null);
  }

  if ( Transform ) Transaction.__proto__ = Transform;
  Transaction.prototype = Object.create( Transform && Transform.prototype );
  Transaction.prototype.constructor = Transaction;

  var prototypeAccessors = { selection: { configurable: true },selectionSet: { configurable: true },storedMarksSet: { configurable: true },isGeneric: { configurable: true },scrolledIntoView: { configurable: true } };

  // :: Selection
  // The transaction's current selection. This defaults to the editor
  // selection [mapped](#state.Selection.map) through the steps in the
  // transaction, but can be overwritten with
  // [`setSelection`](#state.Transaction.setSelection).
  prototypeAccessors.selection.get = function () {
    if (this.curSelectionFor < this.steps.length) {
      this.curSelection = this.curSelection.map(this.doc, this.mapping.slice(this.curSelectionFor));
      this.curSelectionFor = this.steps.length;
    }
    return this.curSelection
  };

  // :: (Selection) → Transaction
  // Update the transaction's current selection. Will determine the
  // selection that the editor gets when the transaction is applied.
  Transaction.prototype.setSelection = function setSelection (selection) {
    if (selection.$from.doc != this.doc)
      { throw new RangeError("Selection passed to setSelection must point at the current document") }
    this.curSelection = selection;
    this.curSelectionFor = this.steps.length;
    this.updated = (this.updated | UPDATED_SEL) & ~UPDATED_MARKS;
    this.storedMarks = null;
    return this
  };

  // :: bool
  // Whether the selection was explicitly updated by this transaction.
  prototypeAccessors.selectionSet.get = function () {
    return (this.updated & UPDATED_SEL) > 0
  };

  // :: (?[Mark]) → Transaction
  // Set the current stored marks.
  Transaction.prototype.setStoredMarks = function setStoredMarks (marks) {
    this.storedMarks = marks;
    this.updated |= UPDATED_MARKS;
    return this
  };

  // :: ([Mark]) → Transaction
  // Make sure the current stored marks or, if that is null, the marks
  // at the selection, match the given set of marks. Does nothing if
  // this is already the case.
  Transaction.prototype.ensureMarks = function ensureMarks (marks) {
    if (!Mark.sameSet(this.storedMarks || this.selection.$from.marks(), marks))
      { this.setStoredMarks(marks); }
    return this
  };

  // :: (Mark) → Transaction
  // Add a mark to the set of stored marks.
  Transaction.prototype.addStoredMark = function addStoredMark (mark) {
    return this.ensureMarks(mark.addToSet(this.storedMarks || this.selection.$head.marks()))
  };

  // :: (union<Mark, MarkType>) → Transaction
  // Remove a mark or mark type from the set of stored marks.
  Transaction.prototype.removeStoredMark = function removeStoredMark (mark) {
    return this.ensureMarks(mark.removeFromSet(this.storedMarks || this.selection.$head.marks()))
  };

  // :: bool
  // Whether the stored marks were explicitly set for this transaction.
  prototypeAccessors.storedMarksSet.get = function () {
    return (this.updated & UPDATED_MARKS) > 0
  };

  Transaction.prototype.addStep = function addStep (step, doc) {
    Transform.prototype.addStep.call(this, step, doc);
    this.updated = this.updated & ~UPDATED_MARKS;
    this.storedMarks = null;
  };

  // :: (number) → Transaction
  // Update the timestamp for the transaction.
  Transaction.prototype.setTime = function setTime (time) {
    this.time = time;
    return this
  };

  // :: (Slice) → Transaction
  // Replace the current selection with the given slice.
  Transaction.prototype.replaceSelection = function replaceSelection (slice) {
    this.selection.replace(this, slice);
    return this
  };

  // :: (Node, ?bool) → Transaction
  // Replace the selection with the given node. When `inheritMarks` is
  // true and the content is inline, it inherits the marks from the
  // place where it is inserted.
  Transaction.prototype.replaceSelectionWith = function replaceSelectionWith (node, inheritMarks) {
    var selection = this.selection;
    if (inheritMarks !== false)
      { node = node.mark(this.storedMarks || (selection.empty ? selection.$from.marks() : (selection.$from.marksAcross(selection.$to) || Mark.none))); }
    selection.replaceWith(this, node);
    return this
  };

  // :: () → Transaction
  // Delete the selection.
  Transaction.prototype.deleteSelection = function deleteSelection () {
    this.selection.replace(this);
    return this
  };

  // :: (string, from: ?number, to: ?number) → Transaction
  // Replace the given range, or the selection if no range is given,
  // with a text node containing the given string.
  Transaction.prototype.insertText = function insertText (text, from, to) {
    if ( to === void 0 ) to = from;

    var schema = this.doc.type.schema;
    if (from == null) {
      if (!text) { return this.deleteSelection() }
      return this.replaceSelectionWith(schema.text(text), true)
    } else {
      if (!text) { return this.deleteRange(from, to) }
      var marks = this.storedMarks;
      if (!marks) {
        var $from = this.doc.resolve(from);
        marks = to == from ? $from.marks() : $from.marksAcross(this.doc.resolve(to));
      }
      this.replaceRangeWith(from, to, schema.text(text, marks));
      if (!this.selection.empty) { this.setSelection(Selection.near(this.selection.$to)); }
      return this
    }
  };

  // :: (union<string, Plugin, PluginKey>, any) → Transaction
  // Store a metadata property in this transaction, keyed either by
  // name or by plugin.
  Transaction.prototype.setMeta = function setMeta (key, value) {
    this.meta[typeof key == "string" ? key : key.key] = value;
    return this
  };

  // :: (union<string, Plugin, PluginKey>) → any
  // Retrieve a metadata property for a given name or plugin.
  Transaction.prototype.getMeta = function getMeta (key) {
    return this.meta[typeof key == "string" ? key : key.key]
  };

  // :: bool
  // Returns true if this transaction doesn't contain any metadata,
  // and can thus safely be extended.
  prototypeAccessors.isGeneric.get = function () {
    for (var _ in this.meta) { return false }
    return true
  };

  // :: () → Transaction
  // Indicate that the editor should scroll the selection into view
  // when updated to the state produced by this transaction.
  Transaction.prototype.scrollIntoView = function scrollIntoView () {
    this.updated |= UPDATED_SCROLL;
    return this
  };

  prototypeAccessors.scrolledIntoView.get = function () {
    return (this.updated & UPDATED_SCROLL) > 0
  };

  Object.defineProperties( Transaction.prototype, prototypeAccessors );

  return Transaction;
}(Transform));

function bind(f, self) {
  return !self || !f ? f : f.bind(self)
}

var FieldDesc = function FieldDesc(name, desc, self) {
  this.name = name;
  this.init = bind(desc.init, self);
  this.apply = bind(desc.apply, self);
};

var baseFields = [
  new FieldDesc("doc", {
    init: function init(config) { return config.doc || config.schema.topNodeType.createAndFill() },
    apply: function apply(tr) { return tr.doc }
  }),

  new FieldDesc("selection", {
    init: function init(config, instance) { return config.selection || Selection.atStart(instance.doc) },
    apply: function apply(tr) { return tr.selection }
  }),

  new FieldDesc("storedMarks", {
    init: function init(config) { return config.storedMarks || null },
    apply: function apply(tr, _marks, _old, state) { return state.selection.$cursor ? tr.storedMarks : null }
  }),

  new FieldDesc("scrollToSelection", {
    init: function init() { return 0 },
    apply: function apply(tr, prev) { return tr.scrolledIntoView ? prev + 1 : prev }
  })
];

// Object wrapping the part of a state object that stays the same
// across transactions. Stored in the state's `config` property.
var Configuration = function Configuration(schema, plugins) {
  var this$1$1 = this;

  this.schema = schema;
  this.fields = baseFields.concat();
  this.plugins = [];
  this.pluginsByKey = Object.create(null);
  if (plugins) { plugins.forEach(function (plugin) {
    if (this$1$1.pluginsByKey[plugin.key])
      { throw new RangeError("Adding different instances of a keyed plugin (" + plugin.key + ")") }
    this$1$1.plugins.push(plugin);
    this$1$1.pluginsByKey[plugin.key] = plugin;
    if (plugin.spec.state)
      { this$1$1.fields.push(new FieldDesc(plugin.key, plugin.spec.state, plugin)); }
  }); }
};

// ::- The state of a ProseMirror editor is represented by an object
// of this type. A state is a persistent data structure—it isn't
// updated, but rather a new state value is computed from an old one
// using the [`apply`](#state.EditorState.apply) method.
//
// A state holds a number of built-in fields, and plugins can
// [define](#state.PluginSpec.state) additional fields.
var EditorState = function EditorState(config) {
  this.config = config;
};

var prototypeAccessors$1 = { schema: { configurable: true },plugins: { configurable: true },tr: { configurable: true } };

// doc:: Node
// The current document.

// selection:: Selection
// The selection.

// storedMarks:: ?[Mark]
// A set of marks to apply to the next input. Will be null when
// no explicit marks have been set.

// :: Schema
// The schema of the state's document.
prototypeAccessors$1.schema.get = function () {
  return this.config.schema
};

// :: [Plugin]
// The plugins that are active in this state.
prototypeAccessors$1.plugins.get = function () {
  return this.config.plugins
};

// :: (Transaction) → EditorState
// Apply the given transaction to produce a new state.
EditorState.prototype.apply = function apply (tr) {
  return this.applyTransaction(tr).state
};

// : (Transaction) → bool
EditorState.prototype.filterTransaction = function filterTransaction (tr, ignore) {
    if ( ignore === void 0 ) ignore = -1;

  for (var i = 0; i < this.config.plugins.length; i++) { if (i != ignore) {
    var plugin = this.config.plugins[i];
    if (plugin.spec.filterTransaction && !plugin.spec.filterTransaction.call(plugin, tr, this))
      { return false }
  } }
  return true
};

// :: (Transaction) → {state: EditorState, transactions: [Transaction]}
// Verbose variant of [`apply`](#state.EditorState.apply) that
// returns the precise transactions that were applied (which might
// be influenced by the [transaction
// hooks](#state.PluginSpec.filterTransaction) of
// plugins) along with the new state.
EditorState.prototype.applyTransaction = function applyTransaction (rootTr) {
  if (!this.filterTransaction(rootTr)) { return {state: this, transactions: []} }

  var trs = [rootTr], newState = this.applyInner(rootTr), seen = null;
  // This loop repeatedly gives plugins a chance to respond to
  // transactions as new transactions are added, making sure to only
  // pass the transactions the plugin did not see before.
   for (;;) {
    var haveNew = false;
    for (var i = 0; i < this.config.plugins.length; i++) {
      var plugin = this.config.plugins[i];
      if (plugin.spec.appendTransaction) {
        var n = seen ? seen[i].n : 0, oldState = seen ? seen[i].state : this;
        var tr = n < trs.length &&
            plugin.spec.appendTransaction.call(plugin, n ? trs.slice(n) : trs, oldState, newState);
        if (tr && newState.filterTransaction(tr, i)) {
          tr.setMeta("appendedTransaction", rootTr);
          if (!seen) {
            seen = [];
            for (var j = 0; j < this.config.plugins.length; j++)
              { seen.push(j < i ? {state: newState, n: trs.length} : {state: this, n: 0}); }
          }
          trs.push(tr);
          newState = newState.applyInner(tr);
          haveNew = true;
        }
        if (seen) { seen[i] = {state: newState, n: trs.length}; }
      }
    }
    if (!haveNew) { return {state: newState, transactions: trs} }
  }
};

// : (Transaction) → EditorState
EditorState.prototype.applyInner = function applyInner (tr) {
  if (!tr.before.eq(this.doc)) { throw new RangeError("Applying a mismatched transaction") }
  var newInstance = new EditorState(this.config), fields = this.config.fields;
  for (var i = 0; i < fields.length; i++) {
    var field = fields[i];
    newInstance[field.name] = field.apply(tr, this[field.name], this, newInstance);
  }
  for (var i$1 = 0; i$1 < applyListeners.length; i$1++) { applyListeners[i$1](this, tr, newInstance); }
  return newInstance
};

// :: Transaction
// Start a [transaction](#state.Transaction) from this state.
prototypeAccessors$1.tr.get = function () { return new Transaction(this) };

// :: (Object) → EditorState
// Create a new state.
//
// config::- Configuration options. Must contain `schema` or `doc` (or both).
//
//    schema:: ?Schema
//    The schema to use (only relevant if no `doc` is specified).
//
//    doc:: ?Node
//    The starting document.
//
//    selection:: ?Selection
//    A valid selection in the document.
//
//    storedMarks:: ?[Mark]
//    The initial set of [stored marks](#state.EditorState.storedMarks).
//
//    plugins:: ?[Plugin]
//    The plugins that should be active in this state.
EditorState.create = function create (config) {
  var $config = new Configuration(config.doc ? config.doc.type.schema : config.schema, config.plugins);
  var instance = new EditorState($config);
  for (var i = 0; i < $config.fields.length; i++)
    { instance[$config.fields[i].name] = $config.fields[i].init(config, instance); }
  return instance
};

// :: (Object) → EditorState
// Create a new state based on this one, but with an adjusted set of
// active plugins. State fields that exist in both sets of plugins
// are kept unchanged. Those that no longer exist are dropped, and
// those that are new are initialized using their
// [`init`](#state.StateField.init) method, passing in the new
// configuration object..
//
// config::- configuration options
//
//   plugins:: [Plugin]
//   New set of active plugins.
EditorState.prototype.reconfigure = function reconfigure (config) {
  var $config = new Configuration(this.schema, config.plugins);
  var fields = $config.fields, instance = new EditorState($config);
  for (var i = 0; i < fields.length; i++) {
    var name = fields[i].name;
    instance[name] = this.hasOwnProperty(name) ? this[name] : fields[i].init(config, instance);
  }
  return instance
};

// :: (?union<Object<Plugin>, string, number>) → Object
// Serialize this state to JSON. If you want to serialize the state
// of plugins, pass an object mapping property names to use in the
// resulting JSON object to plugin objects. The argument may also be
// a string or number, in which case it is ignored, to support the
// way `JSON.stringify` calls `toString` methods.
EditorState.prototype.toJSON = function toJSON (pluginFields) {
  var result = {doc: this.doc.toJSON(), selection: this.selection.toJSON()};
  if (this.storedMarks) { result.storedMarks = this.storedMarks.map(function (m) { return m.toJSON(); }); }
  if (pluginFields && typeof pluginFields == 'object') { for (var prop in pluginFields) {
    if (prop == "doc" || prop == "selection")
      { throw new RangeError("The JSON fields `doc` and `selection` are reserved") }
    var plugin = pluginFields[prop], state = plugin.spec.state;
    if (state && state.toJSON) { result[prop] = state.toJSON.call(plugin, this[plugin.key]); }
  } }
  return result
};

// :: (Object, Object, ?Object<Plugin>) → EditorState
// Deserialize a JSON representation of a state. `config` should
// have at least a `schema` field, and should contain array of
// plugins to initialize the state with. `pluginFields` can be used
// to deserialize the state of plugins, by associating plugin
// instances with the property names they use in the JSON object.
//
// config::- configuration options
//
//   schema:: Schema
//   The schema to use.
//
//   plugins:: ?[Plugin]
//   The set of active plugins.
EditorState.fromJSON = function fromJSON (config, json, pluginFields) {
  if (!json) { throw new RangeError("Invalid input for EditorState.fromJSON") }
  if (!config.schema) { throw new RangeError("Required config field 'schema' missing") }
  var $config = new Configuration(config.schema, config.plugins);
  var instance = new EditorState($config);
  $config.fields.forEach(function (field) {
    if (field.name == "doc") {
      instance.doc = Node.fromJSON(config.schema, json.doc);
    } else if (field.name == "selection") {
      instance.selection = Selection.fromJSON(instance.doc, json.selection);
    } else if (field.name == "storedMarks") {
      if (json.storedMarks) { instance.storedMarks = json.storedMarks.map(config.schema.markFromJSON); }
    } else {
      if (pluginFields) { for (var prop in pluginFields) {
        var plugin = pluginFields[prop], state = plugin.spec.state;
        if (plugin.key == field.name && state && state.fromJSON &&
            Object.prototype.hasOwnProperty.call(json, prop)) {
          // This field belongs to a plugin mapped to a JSON field, read it from there.
          instance[field.name] = state.fromJSON.call(plugin, config, json[prop], instance);
          return
        }
      } }
      instance[field.name] = field.init(config, instance);
    }
  });
  return instance
};

// Kludge to allow the view to track mappings between different
// instances of a state.
//
// FIXME this is no longer needed as of prosemirror-view 1.9.0,
// though due to backwards-compat we should probably keep it around
// for a while (if only as a no-op)
EditorState.addApplyListener = function addApplyListener (f) {
  applyListeners.push(f);
};
EditorState.removeApplyListener = function removeApplyListener (f) {
  var found = applyListeners.indexOf(f);
  if (found > -1) { applyListeners.splice(found, 1); }
};

Object.defineProperties( EditorState.prototype, prototypeAccessors$1 );

var applyListeners = [];

function createCell(cellType, cellContent) {
    if (cellContent) {
        return cellType.createChecked(null, cellContent);
    }
    return cellType.createAndFill();
}

function getTableNodeTypes(schema) {
    if (schema.cached.tableNodeTypes) {
        return schema.cached.tableNodeTypes;
    }
    const roles = {};
    Object.keys(schema.nodes).forEach(type => {
        const nodeType = schema.nodes[type];
        if (nodeType.spec.tableRole) {
            roles[nodeType.spec.tableRole] = nodeType;
        }
    });
    schema.cached.tableNodeTypes = roles;
    return roles;
}

function createTable(schema, rowsCount, colsCount, withHeaderRow, cellContent) {
    const types = getTableNodeTypes(schema);
    const headerCells = [];
    const cells = [];
    for (let index = 0; index < colsCount; index += 1) {
        const cell = createCell(types.cell, cellContent);
        if (cell) {
            cells.push(cell);
        }
        if (withHeaderRow) {
            const headerCell = createCell(types.header_cell, cellContent);
            if (headerCell) {
                headerCells.push(headerCell);
            }
        }
    }
    const rows = [];
    for (let index = 0; index < rowsCount; index += 1) {
        rows.push(types.row.createChecked(null, withHeaderRow && index === 0 ? headerCells : cells));
    }
    return types.table.createChecked(null, rows);
}

function isCellSelection(value) {
    return value instanceof CellSelection;
}

const deleteTableWhenAllCellsSelected = ({ editor }) => {
    const { selection } = editor.state;
    if (!isCellSelection(selection)) {
        return false;
    }
    let cellCount = 0;
    const table = findParentNodeClosestToPos(selection.ranges[0].$from, node => {
        return node.type.name === 'table';
    });
    table === null || table === void 0 ? void 0 : table.node.descendants(node => {
        if (node.type.name === 'table') {
            return false;
        }
        if (['tableCell', 'tableHeader'].includes(node.type.name)) {
            cellCount += 1;
        }
    });
    const allCellsSelected = cellCount === selection.ranges.length;
    if (!allCellsSelected) {
        return false;
    }
    editor.commands.deleteTable();
    return true;
};

function updateColumns(node, colgroup, table, cellMinWidth, overrideCol, overrideValue) {
    let totalWidth = 0;
    let fixedWidth = true;
    let nextDOM = colgroup.firstChild;
    const row = node.firstChild;
    for (let i = 0, col = 0; i < row.childCount; i += 1) {
        const { colspan, colwidth } = row.child(i).attrs;
        for (let j = 0; j < colspan; j += 1, col += 1) {
            const hasWidth = overrideCol === col ? overrideValue : colwidth && colwidth[j];
            const cssWidth = hasWidth ? `${hasWidth}px` : '';
            totalWidth += hasWidth || cellMinWidth;
            if (!hasWidth) {
                fixedWidth = false;
            }
            if (!nextDOM) {
                colgroup.appendChild(document.createElement('col')).style.width = cssWidth;
            }
            else {
                if (nextDOM.style.width !== cssWidth) {
                    nextDOM.style.width = cssWidth;
                }
                nextDOM = nextDOM.nextSibling;
            }
        }
    }
    while (nextDOM) {
        const after = nextDOM.nextSibling;
        nextDOM.parentNode.removeChild(nextDOM);
        nextDOM = after;
    }
    if (fixedWidth) {
        table.style.width = `${totalWidth}px`;
        table.style.minWidth = '';
    }
    else {
        table.style.width = '';
        table.style.minWidth = `${totalWidth}px`;
    }
}
class TableView {
    constructor(node, cellMinWidth) {
        this.node = node;
        this.cellMinWidth = cellMinWidth;
        this.dom = document.createElement('div');
        this.dom.className = 'tableWrapper';
        this.table = this.dom.appendChild(document.createElement('table'));
        this.colgroup = this.table.appendChild(document.createElement('colgroup'));
        updateColumns(node, this.colgroup, this.table, cellMinWidth);
        this.contentDOM = this.table.appendChild(document.createElement('tbody'));
    }
    update(node) {
        if (node.type !== this.node.type) {
            return false;
        }
        this.node = node;
        updateColumns(node, this.colgroup, this.table, this.cellMinWidth);
        return true;
    }
    ignoreMutation(mutation) {
        return mutation.type === 'attributes' && (mutation.target === this.table || this.colgroup.contains(mutation.target));
    }
}

const Table = Node$1.create({
    name: 'table',
    addOptions() {
        return {
            HTMLAttributes: {},
            resizable: false,
            handleWidth: 5,
            cellMinWidth: 25,
            // TODO: fix
            View: TableView,
            lastColumnResizable: true,
            allowTableNodeSelection: false,
        };
    },
    content: 'tableRow+',
    tableRole: 'table',
    isolating: true,
    group: 'block',
    parseHTML() {
        return [
            { tag: 'table' },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ['table', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), ['tbody', 0]];
    },
    addCommands() {
        return {
            insertTable: ({ rows = 3, cols = 3, withHeaderRow = true } = {}) => ({ tr, dispatch, editor }) => {
                const node = editor.schema.node('div', { class: 'table-responsive'}, createTable(editor.schema, rows, cols, withHeaderRow))

                if (dispatch) {
                    const initialSelection = tr.selection
                    const offset = initialSelection.anchor + 1;
                    tr.replaceSelectionWith(node)
                        .scrollIntoView()
                        .setSelection(TextSelection.near(tr.doc.resolve(offset)));
                }
                return true;
                /*const node = createTable(editor.schema, rows, cols, withHeaderRow);

                if (dispatch) {
                    const initialSelection = tr.selection
                    const offset = initialSelection.anchor + 1;
                    tr.wrap(new NodeRange(initialSelection.$from, tr.selection.$to, 0),
                        [{type: editor.schema.nodeType('div'), attrs: { class: 'table-responsive'}}])
                        .replaceSelectionWith(node)
                        .scrollIntoView()
                        .setSelection(TextSelection.near(tr.doc.resolve(offset)));
                }
                return true;*/
            },
            addColumnBefore: () => ({ state, dispatch }) => {
                return addColumnBefore(state, dispatch);
            },
            addColumnAfter: () => ({ state, dispatch }) => {
                return addColumnAfter(state, dispatch);
            },
            deleteColumn: () => ({ state, dispatch }) => {
                return deleteColumn(state, dispatch);
            },
            addRowBefore: () => ({ state, dispatch }) => {
                return addRowBefore(state, dispatch);
            },
            addRowAfter: () => ({ state, dispatch }) => {
                return addRowAfter(state, dispatch);
            },
            deleteRow: () => ({ state, dispatch }) => {
                return deleteRow(state, dispatch);
            },
            deleteTable: () => ({ state, dispatch }) => {
                return deleteTable(state, dispatch);
            },
            mergeCells: () => ({ state, dispatch }) => {
                return mergeCells(state, dispatch);
            },
            splitCell: () => ({ state, dispatch }) => {
                return splitCell(state, dispatch);
            },
            toggleHeaderColumn: () => ({ state, dispatch }) => {
                return toggleHeaderColumn(state, dispatch);
            },
            toggleHeaderRow: () => ({ state, dispatch }) => {
                return toggleHeaderRow(state, dispatch);
            },
            toggleHeaderCell: () => ({ state, dispatch }) => {
                return toggleHeaderCell(state, dispatch);
            },
            mergeOrSplit: () => ({ state, dispatch }) => {
                if (mergeCells(state, dispatch)) {
                    return true;
                }
                return splitCell(state, dispatch);
            },
            setCellAttribute: (name, value) => ({ state, dispatch }) => {
                return setCellAttr(name, value)(state, dispatch);
            },
            goToNextCell: () => ({ state, dispatch }) => {
                return goToNextCell(1)(state, dispatch);
            },
            goToPreviousCell: () => ({ state, dispatch }) => {
                return goToNextCell(-1)(state, dispatch);
            },
            fixTables: () => ({ state, dispatch }) => {
                if (dispatch) {
                    fixTables(state);
                }
                return true;
            },
            setCellSelection: position => ({ tr, dispatch }) => {
                if (dispatch) {
                    const selection = CellSelection.create(tr.doc, position.anchorCell, position.headCell);
                    // @ts-ignore
                    tr.setSelection(selection);
                }
                return true;
            },
        };
    },
    addKeyboardShortcuts() {
        return {
            Tab: () => {
                if (this.editor.commands.goToNextCell()) {
                    return true;
                }
                if (!this.editor.can().addRowAfter()) {
                    return false;
                }
                return this.editor
                    .chain()
                    .addRowAfter()
                    .goToNextCell()
                    .run();
            },
            'Shift-Tab': () => this.editor.commands.goToPreviousCell(),
            Backspace: deleteTableWhenAllCellsSelected,
            'Mod-Backspace': deleteTableWhenAllCellsSelected,
            Delete: deleteTableWhenAllCellsSelected,
            'Mod-Delete': deleteTableWhenAllCellsSelected,
        };
    },
    addProseMirrorPlugins() {
        const isResizable = this.options.resizable && this.editor.isEditable;
        return [
            ...(isResizable ? [columnResizing({
                    handleWidth: this.options.handleWidth,
                    cellMinWidth: this.options.cellMinWidth,
                    View: this.options.View,
                    // TODO: PR for @types/prosemirror-tables
                    // @ts-ignore (incorrect type)
                    lastColumnResizable: this.options.lastColumnResizable,
                })] : []),
            tableEditing({
                allowTableNodeSelection: this.options.allowTableNodeSelection,
            }),
        ];
    },
    extendNodeSchema(extension) {
        const context = {
            name: extension.name,
            options: extension.options,
        };
        return {
            tableRole: callOrReturn(getExtensionField(extension, 'tableRole', context)),
        };
    },
});

export { Table, createTable, Table as default };
//# sourceMappingURL=tiptap-extension-table.esm.js.map
