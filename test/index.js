import process from 'node:process';
import FixtureStdout from 'fixture-stdout';
import stripAnsi from 'strip-ansi';
import test from 'ava';
import esmock from 'esmock';

const stderr = new FixtureStdout({
	stream: process.stderr,
});

const createConfigStore = stores => class MockConfigStore {
	constructor(name, defaults) {
		this.name = name;
		this.path = 'mock-configstore-path';
		this.store = new Map(Object.entries({
			...defaults,
			lastUpdateCheck: Date.now(),
			update: {
				latest: '1.0.0',
				current: '0.0.1',
				type: 'major',
				name: 'update-notifier-tester',
			},
		}));
		stores.push(this);
	}

	get(key) {
		return this.store.get(key);
	}

	set(key, value) {
		this.store.set(key, value);
	}

	delete(key) {
		this.store.delete(key);
	}
};

let errorLogs = '';
let isTTY;
let nodeEnv;

test.beforeEach(() => {
	isTTY = process.stdout.isTTY;
	nodeEnv = process.env.NODE_ENV;
	process.stdout.isTTY = true;
	process.env.NODE_ENV = 'ava-test';

	stderr.capture(value => {
		errorLogs += value;
		return false;
	});
});

test.afterEach(() => {
	process.stdout.isTTY = isTTY;
	if (nodeEnv === undefined) {
		delete process.env.NODE_ENV;
	} else {
		process.env.NODE_ENV = nodeEnv;
	}

	stderr.release();
	errorLogs = '';
});

test('shows an update notification from cached update information', async t => {
	const stores = [];
	const updateNotifier = await esmock('../index.js', undefined, {
		configstore: createConfigStore(stores),
		'is-in-ci': false,
		'is-npm': {isNpmOrYarn: false},
	});

	const notifier = updateNotifier({
		pkg: {
			name: 'update-notifier-tester',
			version: '0.0.2',
		},
	});

	notifier.notify({
		defer: false,
		isGlobal: true,
	});

	const output = stripAnsi(errorLogs);
	t.true(output.includes('Update available 0.0.2 → 1.0.0'));
	t.true(output.includes('Run npm i -g update-notifier-tester to update'));
	t.false(stores[0].store.has('update'));
});
