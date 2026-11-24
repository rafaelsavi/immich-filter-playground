// Run with: node --test web_tests/
// Loads the browser script in a sandbox so the pure filter-compiler and
// rule-tree helpers can be tested without a DOM or any npm dependencies.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
	path.join(__dirname, '..', 'internal', 'server', 'static', 'app.js'),
	'utf8'
);

const sandbox = {
	console,
	URL,
	setTimeout,
	clearTimeout,
	AbortController,
	window: {},
	document: { addEventListener() {} },
	localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'app.js' });

// Values cross the vm realm boundary as JSON so deepStrictEqual compares plain objects.
function call(fnExpr, ...args) {
	sandbox.__args = JSON.parse(JSON.stringify(args));
	const out = vm.runInContext(`JSON.stringify(${fnExpr}(...__args))`, sandbox);
	return out === undefined ? undefined : JSON.parse(out);
}

const rule = (field, operator, value, extra = {}) => ({
	id: `r_${Math.random().toString(36).slice(2, 8)}`,
	type: 'rule', field, operator, value, ...extra
});
const group = (combiner, children) => ({
	id: `g_${Math.random().toString(36).slice(2, 8)}`,
	type: 'group', combiner, children
});
const compile = tree => call('compileGroupToAST', tree);
const sortPairs = branches => branches.map(b => JSON.stringify(b)).sort();

test('empty tree compiles to an empty filter', () => {
	assert.deepEqual(compile(group('AND', [])), {});
});

test('simple AND rules merge into one object', () => {
	const ast = compile(group('AND', [
		rule('people', 'all', ['p1']),
		rule('favorite', 'true', true),
		rule('country', 'in', ['Japan'])
	]));
	assert.deepEqual(ast, {
		personIds: { all: ['p1'] },
		isFavorite: { eq: true },
		country: { in: ['Japan'] }
	});
});

test('AND of two "any" lists is a cross product, not a union', () => {
	const ast = compile(group('AND', [
		rule('albums', 'any', ['a', 'b']),
		rule('albums', 'any', ['c', 'd'])
	]));
	assert.equal(ast.albumIds, undefined, 'must not collapse into one any-list');
	assert.deepEqual(sortPairs(ast.or), sortPairs([
		{ albumIds: { all: ['a', 'c'] } },
		{ albumIds: { all: ['a', 'd'] } },
		{ albumIds: { all: ['b', 'c'] } },
		{ albumIds: { all: ['b', 'd'] } }
	]));
});

test('AND of identical "any" lists stays a single condition', () => {
	const ast = compile(group('AND', [
		rule('tags', 'any', ['x', 'y']),
		rule('tags', 'any', ['y', 'x'])
	]));
	assert.deepEqual(ast, { tagIds: { any: ['x', 'y'] } });
});

test('"all" and "none" lists union under AND', () => {
	const ast = compile(group('AND', [
		rule('people', 'all', ['p1']),
		rule('people', 'all', ['p2']),
		rule('people', 'none', ['p3']),
		rule('people', 'none', ['p4'])
	]));
	assert.deepEqual(ast, { personIds: { all: ['p1', 'p2'], none: ['p3', 'p4'] } });
});

test('"in" lists intersect under AND and "notIn" lists union', () => {
	const ast = compile(group('AND', [
		rule('country', 'in', ['Japan', 'Italy']),
		rule('country', 'in', ['Italy', 'France']),
		rule('city', 'notIn', ['Rome']),
		rule('city', 'notIn', ['Milan'])
	]));
	assert.deepEqual(ast, {
		country: { in: ['Italy'] },
		city: { notIn: ['Rome', 'Milan'] }
	});
});

test('OR group compiles to branches', () => {
	const ast = compile(group('OR', [
		rule('country', 'in', ['Japan']),
		rule('favorite', 'true', true)
	]));
	assert.deepEqual(ast, { or: [{ country: { in: ['Japan'] } }, { isFavorite: { eq: true } }] });
});

test('AND with a nested OR keeps direct fields beside the or-list', () => {
	const ast = compile(group('AND', [
		rule('people', 'all', ['p1']),
		group('OR', [rule('country', 'in', ['Japan']), rule('country', 'in', ['Italy'])])
	]));
	assert.deepEqual(ast, {
		personIds: { all: ['p1'] },
		or: [{ country: { in: ['Japan'] } }, { country: { in: ['Italy'] } }]
	});
});

test('date rules emit gte/lte only for the active operator', () => {
	assert.deepEqual(
		compile(group('AND', [rule('date', 'between', '', { dateAfter: '2026-01-01', dateBefore: '2026-01-31' })])),
		{ takenAt: { gte: '2026-01-01', lte: '2026-01-31' } }
	);
	assert.deepEqual(
		compile(group('AND', [rule('date', 'before', '', { dateAfter: '2026-01-01', dateBefore: '2026-01-31' })])),
		{ takenAt: { lte: '2026-01-31' } }
	);
	assert.deepEqual(compile(group('AND', [rule('date', 'after', '')])), {});
});

test('rating zero is preserved', () => {
	assert.deepEqual(compile(group('AND', [rule('rating', 'eq', 0)])), { rating: { eq: 0 } });
});

const roundTrips = {
	'multi-field AND': {
		personIds: { all: ['p1', 'p2'] },
		isFavorite: { eq: true },
		country: { in: ['Japan'] },
		rating: { gte: 3 }
	},
	'OR of two fields': { or: [{ country: { in: ['Japan'] } }, { albumIds: { any: ['a1'] } }] },
	'fields beside OR': { personIds: { all: ['p1'] }, or: [{ city: { in: ['Rome'] } }, { city: { in: ['Paris'] } }] },
	'text patterns': { description: { like: 'beach' }, originalFileName: { startsWith: 'IMG_' } },
	'takenAt range': { takenAt: { gte: '2026-01-01', lte: '2026-02-01' } }
};
for (const [name, ast] of Object.entries(roundTrips)) {
	test(`round trip: ${name}`, () => {
		const tree = call('astToRuleGroup', ast);
		assert.deepEqual(compile(tree), ast);
	});
}

test('unknown filter fields survive a round trip as raw rules', () => {
	const ast = { libraryId: { eq: 'lib-1' }, checksum: { in: ['abc'] }, country: { in: ['Japan'] } };
	const tree = call('astToRuleGroup', ast);
	const raws = tree.children.filter(c => c.field === 'raw').map(c => c.rawKey).sort();
	assert.deepEqual(raws, ['checksum', 'libraryId']);
	assert.deepEqual(compile(tree), ast);
});

test('multi-value type/visibility and unsupported operators are not truncated', () => {
	const ast = {
		type: { in: ['IMAGE', 'VIDEO'] },
		visibility: { notIn: ['hidden'] },
		rating: { gt: 2 }
	};
	assert.deepEqual(compile(call('astToRuleGroup', ast)), ast);
});

test('single-value type maps to a visual media rule', () => {
	const tree = call('astToRuleGroup', { type: { in: ['VIDEO'] } });
	assert.equal(tree.children[0].field, 'media_type');
	assert.equal(tree.children[0].operator, 'VIDEO');
});

test('groupNodesIntoSubgroup wraps the selection in an alternating-combiner group', () => {
	const a = rule('country', 'in', ['A']);
	const b = rule('country', 'in', ['B']);
	const c = rule('favorite', 'true', true);
	const tree = group('AND', [a, b, c]);
	sandbox.__tree = JSON.parse(JSON.stringify(tree));
	sandbox.__ids = [a.id, b.id];
	const out = JSON.parse(vm.runInContext(
		'(() => { const g = groupNodesIntoSubgroup(__tree, new Set(__ids)); return JSON.stringify({ g, tree: __tree }); })()',
		sandbox
	));
	assert.equal(out.g.combiner, 'OR');
	assert.deepEqual(out.g.children.map(n => n.id), [a.id, b.id]);
	assert.deepEqual(out.tree.children.map(n => n.id), [out.g.id, c.id]);
});

test('ungroupNode splices children into the parent in place', () => {
	const a = rule('country', 'in', ['A']);
	const b = rule('country', 'in', ['B']);
	const inner = group('OR', [a, b]);
	const c = rule('favorite', 'true', true);
	sandbox.__tree = JSON.parse(JSON.stringify(group('AND', [inner, c])));
	sandbox.__gid = inner.id;
	const out = JSON.parse(vm.runInContext(
		'(() => { const ok = ungroupNode(__tree, __gid); return JSON.stringify({ ok, ids: __tree.children.map(n => n.id) }); })()',
		sandbox
	));
	assert.equal(out.ok, true);
	assert.deepEqual(out.ids, [a.id, b.id, c.id]);
});

test('moveNodesToGroup refuses to move a group into itself and prunes emptied groups', () => {
	const a = rule('country', 'in', ['A']);
	const inner = group('OR', [a]);
	const target = group('OR', []);
	sandbox.__tree = JSON.parse(JSON.stringify(group('AND', [inner, target])));
	sandbox.__innerId = inner.id;
	sandbox.__aId = a.id;
	sandbox.__targetId = target.id;
	const out = JSON.parse(vm.runInContext(
		`(() => {
			const self = moveNodesToGroup(__tree, new Set([__innerId]), __innerId);
			const moved = moveNodesToGroup(__tree, new Set([__aId]), __targetId);
			return JSON.stringify({ self, moved, ids: __tree.children.map(n => n.id) });
		})()`,
		sandbox
	));
	assert.equal(out.self, false);
	assert.equal(out.moved, true);
	assert.deepEqual(out.ids, [target.id], 'emptied source group is removed');
});
