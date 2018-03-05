import Type from '../Struct/Type.js'
import ItemJSON from '../Struct/ItemJSON.js'
import ItemString from '../Struct/ItemString.js'
import { logID } from '../MessageHandler/messageToString.js'
import YEvent from '../Util/YEvent.js'

/**
 * Event that describes the changes on a YArray
 *
 * @param {YArray} yarray The changed type
 * @param {Boolean} remote Whether the changed was caused by a remote peer
 * @param {Transaction} transaction The transaction object
 */
export class YArrayEvent extends YEvent {
  constructor (yarray, remote, transaction) {
    super(yarray)
    this.remote = remote
    this._transaction = transaction
    this._addedElements = null
    this._removedElements = null
  }

  /**
   * Child elements that were added in this transaction.
   *
   * @return {Set}
   */
  get addedElements () {
    if (this._addedElements === null) {
      const target = this.target
      const transaction = this._transaction
      const addedElements = new Set()
      transaction.newTypes.forEach(function (type) {
        if (type._parent === target && !transaction.deletedStructs.has(type)) {
          addedElements.add(type)
        }
      })
      this._addedElements = addedElements
    }
    return this._addedElements
  }

  /**
   * Child elements that were removed in this transaction.
   *
   * @return {Set}
   */
  get removedElements () {
    if (this._removedElements === null) {
      const target = this.target
      const transaction = this._transaction
      const removedElements = new Set()
      transaction.deletedStructs.forEach(function (struct) {
        if (struct._parent === target && !transaction.newTypes.has(struct)) {
          removedElements.add(struct)
        }
      })
      this._removedElements = removedElements
    }
    return this._removedElements
  }
}

/**
 * A shared Array implementation.
 */
export default class YArray extends Type {
  /**
   * @private
   * Creates YArray Event and calls observers.
   */
  _callObserver (transaction, parentSubs, remote) {
    this._callEventHandler(transaction, new YArrayEvent(this, remote, transaction))
  }

  /**
   * Returns the i-th element from a YArray.
   *
   * @param {Integer} index The index of the element to return from the YArray
   */
  get (index) {
    let n = this._start
    while (n !== null) {
      if (!n._deleted && n._countable) {
        if (index < n._length) {
          if (n.constructor === ItemJSON || n.constructor === ItemString) {
            return n._content[index]
          } else {
            return n
          }
        }
        index -= n._length
      }
      n = n._right
    }
  }

  /**
   * Transforms this YArray to a JavaScript Array.
   *
   * @return {Array}
   */
  toArray () {
    return this.map(c => c)
  }

  /**
   * Transforms this Shared Type to a JSON object.
   *
   * @return {Array}
   */
  toJSON () {
    return this.map(c => {
      if (c instanceof Type) {
        if (c.toJSON !== null) {
          return c.toJSON()
        } else {
          return c.toString()
        }
      }
      return c
    })
  }

  /**
   * Returns an Array with the result of calling a provided function on every
   * element of this YArray.
   *
   * @param {Function} f Function that produces an element of the new Array
   * @return {Array} A new array with each element being the result of the
   *                 callback function
   */
  map (f) {
    const res = []
    this.forEach((c, i) => {
      res.push(f(c, i, this))
    })
    return res
  }

  /**
   * Executes a provided function on once on overy element of this YArray.
   *
   * @param {Function} f A function to execute on every element of this YArray.
   */
  forEach (f) {
    let index = 0
    let n = this._start
    while (n !== null) {
      if (!n._deleted && n._countable) {
        if (n instanceof Type) {
          f(n, index++, this)
        } else {
          const content = n._content
          const contentLen = content.length
          for (let i = 0; i < contentLen; i++) {
            index++
            f(content[i], index, this)
          }
        }
      }
      n = n._right
    }
  }

  /**
   * Computes the length of this YArray.
   */
  get length () {
    let length = 0
    let n = this._start
    while (n !== null) {
      if (!n._deleted && n._countable) {
        length += n._length
      }
      n = n._right
    }
    return length
  }

  [Symbol.iterator] () {
    return {
      next: function () {
        while (this._item !== null && (this._item._deleted || this._item._length <= this._itemElement)) {
          // item is deleted or itemElement does not exist (is deleted)
          this._item = this._item._right
          this._itemElement = 0
        }
        if (this._item === null) {
          return {
            done: true
          }
        }
        let content
        if (this._item instanceof Type) {
          content = this._item
        } else {
          content = this._item._content[this._itemElement++]
        }
        return {
          value: [this._count, content],
          done: false
        }
      },
      _item: this._start,
      _itemElement: 0,
      _count: 0
    }
  }

  /**
   * Deletes elements starting from an index.
   *
   * @param {Integer} index Index at which to start deleting elements
   * @param {Integer} length The number of elements to remove. Defaults to 1.
   */
  delete (index, length = 1) {
    this._y.transact(() => {
      let item = this._start
      let count = 0
      while (item !== null && length > 0) {
        if (!item._deleted && item._countable) {
          if (count <= index && index < count + item._length) {
            const diffDel = index - count
            item = item._splitAt(this._y, diffDel)
            item._splitAt(this._y, length)
            length -= item._length
            item._delete(this._y)
            count += diffDel
          } else {
            count += item._length
          }
        }
        item = item._right
      }
    })
    if (length > 0) {
      throw new Error('Delete exceeds the range of the YArray')
    }
  }

  /**
   * @private
   * Inserts content after an element container.
   *
   * @param {Item} left The element container to use as a reference.
   * @param {Array} content The Array of content to insert (see {@see insert})
   */
  insertAfter (left, content) {
    this._transact(y => {
      let right
      if (left === null) {
        right = this._start
      } else {
        right = left._right
      }
      let prevJsonIns = null
      for (let i = 0; i < content.length; i++) {
        let c = content[i]
        if (typeof c === 'function') {
          c = new c() // eslint-disable-line new-cap
        }
        if (c instanceof Type) {
          if (prevJsonIns !== null) {
            if (y !== null) {
              prevJsonIns._integrate(y)
            }
            left = prevJsonIns
            prevJsonIns = null
          }
          c._origin = left
          c._left = left
          c._right = right
          c._right_origin = right
          c._parent = this
          if (y !== null) {
            c._integrate(y)
          } else if (left === null) {
            this._start = c
          } else {
            left._right = c
          }
          left = c
        } else {
          if (prevJsonIns === null) {
            prevJsonIns = new ItemJSON()
            prevJsonIns._origin = left
            prevJsonIns._left = left
            prevJsonIns._right = right
            prevJsonIns._right_origin = right
            prevJsonIns._parent = this
            prevJsonIns._content = []
          }
          prevJsonIns._content.push(c)
        }
      }
      if (prevJsonIns !== null) {
        if (y !== null) {
          prevJsonIns._integrate(y)
        } else if (prevJsonIns._left === null) {
          this._start = prevJsonIns
        }
      }
    })
  }

  /**
   * Inserts new content at an index.
   *
   * Important: This function expects an array of content. Not just a content
   * object. The reason for this "weirdness" is that inserting several elements
   * is very efficient when it is done as a single operation.
   *
   * @example
   *  // Insert character 'a' at position 0
   *  yarray.insert(0, ['a'])
   *  // Insert numbers 1, 2 at position 1
   *  yarray.insert(2, [1, 2])
   *
   * @param {Integer} index The index to insert content at.
   * @param {Array} content The array of content
   */
  insert (index, content) {
    this._transact(() => {
      let left = null
      let right = this._start
      let count = 0
      const y = this._y
      while (right !== null) {
        const rightLen = right._deleted ? 0 : (right._length - 1)
        if (count <= index && index <= count + rightLen) {
          const splitDiff = index - count
          right = right._splitAt(y, splitDiff)
          left = right._left
          count += splitDiff
          break
        }
        if (!right._deleted) {
          count += right._length
        }
        left = right
        right = right._right
      }
      if (index > count) {
        throw new Error('Index exceeds array range!')
      }
      this.insertAfter(left, content)
    })
  }

  /**
   * Appends content to this YArray.
   *
   * @param {Array} content Array of content to append.
   */
  push (content) {
    let n = this._start
    let lastUndeleted = null
    while (n !== null) {
      if (!n._deleted) {
        lastUndeleted = n
      }
      n = n._right
    }
    this.insertAfter(lastUndeleted, content)
  }

  /**
   * @private
   * Transform this YArray to a readable format.
   * Useful for logging as all Items implement this method.
   */
  _logString () {
    const left = this._left !== null ? this._left._lastId : null
    const origin = this._origin !== null ? this._origin._lastId : null
    return `YArray(id:${logID(this._id)},start:${logID(this._start)},left:${logID(left)},origin:${logID(origin)},right:${logID(this._right)},parent:${logID(this._parent)},parentSub:${this._parentSub})`
  }
}
