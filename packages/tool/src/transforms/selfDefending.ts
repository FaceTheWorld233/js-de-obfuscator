import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'
import * as m from '@codemod/matchers'
import {
  constMemberExpression,
  emptyIife,
  falseMatcher,
  findParent,
  matchIife,
  trueMatcher,
} from '../utils/matcher'
import type { Transform } from '.'

/**
 * 移除自卫代码
 * @see {@link https://github.com/j4k0xb/webcrack/blob/master/src/deobfuscator/selfDefending.ts}
 * @example
 * 移除与之相应的代码
 * var _0x318428 = function () {
 *   var _0x17ed27 = true;
 *   return function (_0x5a26f9, _0x2a79cb) {
 *     var _0x175044 = _0x17ed27 ? function () {
 *       if (_0x2a79cb) {
 *         var _0x421594 = _0x2a79cb["apply"](_0x5a26f9, arguments);
 *         _0x2a79cb = null;
 *         return _0x421594;
 *       }
 *     } : function () {};
 *     _0x17ed27 = false;
 *     return _0x175044;
 *   };
 * }();
 */
export default {
  name: '移除自卫代码',
  visitor() {
    const callController = m.capture(m.anyString())
    const firstCall = m.capture(m.identifier())
    const rfn = m.capture(m.identifier())
    const context = m.capture(m.identifier())
    const res = m.capture(m.identifier())
    const fn = m.capture(m.identifier())

    // const callControllerFunctionName = (function() { ... })();
    const matcher = m.variableDeclarator(
      m.identifier(callController),
      matchIife([
        // let firstCall = true;
        m.variableDeclaration(undefined, [
          m.variableDeclarator(firstCall, trueMatcher),
        ]),
        // return function (context, fn) {
        m.returnStatement(
          m.functionExpression(
            null,
            [context, fn],
            m.blockStatement([
              m.variableDeclaration(undefined, [
                // const rfn = firstCall ? function() {
                m.variableDeclarator(
                  rfn,
                  m.conditionalExpression(
                    m.fromCapture(firstCall),
                    m.functionExpression(
                      null,
                      [],
                      m.blockStatement([
                        // if (fn) {
                        m.ifStatement(
                          m.fromCapture(fn),
                          m.blockStatement([
                            // const res = fn.apply(context, arguments);
                            m.variableDeclaration(undefined, [
                              m.variableDeclarator(
                                res,
                                m.callExpression(
                                  constMemberExpression(
                                    m.fromCapture(fn),
                                    'apply',
                                  ),
                                  [
                                    m.fromCapture(context),
                                    m.identifier('arguments'),
                                  ],
                                ),
                              ),
                            ]),
                            // fn = null;
                            m.expressionStatement(
                              m.assignmentExpression(
                                '=',
                                m.fromCapture(fn),
                                m.nullLiteral(),
                              ),
                            ),
                            // return res;
                            m.returnStatement(m.fromCapture(res)),
                          ]),
                        ),
                      ]),
                    ),
                    // : function() {}
                    m.functionExpression(null, [], m.blockStatement([])),
                  ),
                ),
              ]),
              // firstCall = false;
              m.expressionStatement(
                m.assignmentExpression(
                  '=',
                  m.fromCapture(firstCall),
                  falseMatcher,
                ),
              ),
              // return rfn;
              m.returnStatement(m.fromCapture(rfn)),
            ]),
          ),
        ),
      ]),
    )
    // 匹配与之代码相似的代码
    /* const _0x318428 = (function () {
      let _0x17ed27 = true
      return function (_0x5a26f9, _0x2a79cb) {
        const _0x175044 = _0x17ed27
          ? function () {
            if (_0x2a79cb) {
              // eslint-disable-next-line prefer-rest-params
              const _0x421594 = _0x2a79cb.apply(_0x5a26f9, arguments)

              _0x2a79cb = null
              return _0x421594
            }
          }
          : function () {}

        _0x17ed27 = false
        return _0x175044
      }
    }()) */

    return {
      VariableDeclarator(path) {
        if (!matcher.match(path.node)) return
        const binding = path.scope.getBinding(callController.current!)!
        // const callControllerFunctionName = (function() { ... })();
        //       ^ path/binding

        binding.referencePaths
          .filter(ref => ref.parent.type === 'CallExpression')
          .forEach((ref) => {
            if (ref.parentPath?.parent.type === 'CallExpression') {
              // callControllerFunctionName(this, function () { ... })();
              // ^ ref
              ref.parentPath.parentPath?.remove()
            }
            else {
              // const selfDefendingFunctionName = callControllerFunctionName(this, function () {
              // selfDefendingFunctionName();      ^ ref
              removeSelfDefendingRefs(ref as NodePath<t.Identifier>)
            }

            // leftover (function () {})() from debug protection function call
            findParent(ref, emptyIife)?.remove()

            this.changes++
          })

        path.remove()
        this.changes++
      },
      noScope: true,
    }
  },
} satisfies Transform

function removeSelfDefendingRefs(path: NodePath<t.Identifier>) {
  const varName = m.capture(m.anyString())
  const varMatcher = m.variableDeclarator(
    m.identifier(varName),
    m.callExpression(m.identifier(path.node.name)),
  )
  const callMatcher = m.expressionStatement(
    m.callExpression(m.identifier(m.fromCapture(varName)), []),
  )
  const varDecl = findParent(path, varMatcher)

  if (varDecl) {
    const binding = varDecl.scope.getBinding(varName.current!)

    binding?.referencePaths.forEach((ref) => {
      if (callMatcher.match(ref.parentPath?.parent))
        ref.parentPath?.parentPath?.remove()
    })
    varDecl.remove()
  }
}