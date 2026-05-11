import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'ava';
import esmock from 'esmock';

const generateSettings = (options = {}) => ({
	pkg: {
		name: 'update-notifier-tester',
		version: '0.0.2',
	},
	distTag: options.distTag,
});

const createCheckTestContext = async configValues => {
	const spawnCalls = [];
	const stores = [];
	let unrefCalled = false;

	class MockConfigStore {
		constructor(name, defaults) {
			this.name = name;
			this.path = 'mock-configstore-path';
			this.store = new Map(Object.entries({
				...defaults,
				...configValues,
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
	}

	const spawn = (...arguments_) => {
		spawnCalls.push(arguments_);

		return {
			unref() {
				unrefCalled = true;
			},
		};
	};

	const {default: UpdateNotifier} = await esmock('../update-notifier.js', {
		configstore: MockConfigStore,
		'node:child_process': {spawn},
	}, {'is-in-ci': false});

	return {
		UpdateNotifier,
		stores,
		spawnCalls,
		get unrefCalled() {
			return unrefCalled;
		},
	};
};

let argv;
let configstorePath;

test.beforeEach(() => {
	// Prevents NODE_ENV 'test' default behavior which disables `update-notifier`
	process.env.NODE_ENV = 'ava-test';

	argv = [...process.argv];
});

test.afterEach(() => {
	delete process.env.NO_UPDATE_NOTIFIER;
	process.argv = argv;

	setTimeout(() => {
		try {
			fs.unlinkSync(configstorePath);
		} catch {}
	}, 10_000);
});

test('fetch info', async t => {
	const updateNotifier = await esmock('../index.js', undefined, {'is-in-ci': false});
	configstorePath = updateNotifier(generateSettings()).config.path;
	const update = await updateNotifier(generateSettings()).fetchInfo();
	console.log(update);
	t.is(update.latest, '0.0.2');
});

test('fetch info with dist-tag', async t => {
	const updateNotifier = await esmock('../index.js', undefined, {'is-in-ci': false});
	configstorePath = updateNotifier(generateSettings()).config.path;
	const update = await updateNotifier(generateSettings({distTag: '0.0.3-rc1'})).fetchInfo();
	t.is(update.latest, '0.0.3-rc1');
});

test('don\'t initialize configStore when NO_UPDATE_NOTIFIER is set', async t => {
	const updateNotifier = await esmock('../index.js', undefined, {'is-in-ci': false});
	configstorePath = updateNotifier(generateSettings()).config.path;
	process.env.NO_UPDATE_NOTIFIER = '1';
	const notifier = updateNotifier(generateSettings());
	t.is(notifier.config, undefined);
});

test('don\'t initialize configStore when --no-update-notifier is set', async t => {
	const updateNotifier = await esmock('../index.js', undefined, {'is-in-ci': false});
	configstorePath = updateNotifier(generateSettings()).config.path;
	process.argv.push('--no-update-notifier');
	const notifier = updateNotifier(generateSettings());
	t.is(notifier.config, undefined);
});

test('don\'t initialize configStore when NODE_ENV === "test"', async t => {
	process.env.NODE_ENV = 'test';
	const updateNotifier = await esmock('../index.js', undefined, {'is-in-ci': false});
	const notifier = updateNotifier(generateSettings());
	t.is(notifier.config, undefined);
});

test('check uses cached update information and clears it', async t => {
	const cachedUpdate = {
		current: '0.0.1',
		latest: '1.0.0',
		type: 'major',
		name: 'update-notifier-tester',
	};

	const {UpdateNotifier, stores, spawnCalls} = await createCheckTestContext({
		lastUpdateCheck: Date.now(),
		update: cachedUpdate,
	});
	const notifier = new UpdateNotifier(generateSettings());

	notifier.check();

	t.deepEqual(notifier.update, {
		...cachedUpdate,
		current: '0.0.2',
	});
	t.false(stores[0].store.has('update'));
	t.deepEqual(spawnCalls, []);
});

test('check skips update checks when opted out', async t => {
	const cachedUpdate = {
		current: '0.0.1',
		latest: '1.0.0',
		type: 'major',
		name: 'update-notifier-tester',
	};

	const {UpdateNotifier, stores, spawnCalls} = await createCheckTestContext({
		lastUpdateCheck: 0,
		optOut: true,
		update: cachedUpdate,
	});
	const notifier = new UpdateNotifier(generateSettings());

	notifier.check();

	t.is(notifier.update, undefined);
	t.deepEqual(stores[0].store.get('update'), cachedUpdate);
	t.deepEqual(spawnCalls, []);
});

test('check spawns a detached update checker after the interval', async t => {
	const context = await createCheckTestContext({lastUpdateCheck: 0});
	const notifier = new context.UpdateNotifier({
		...generateSettings(),
		updateCheckInterval: 1,
	});

	notifier.check();

	t.is(context.spawnCalls.length, 1);
	const [command, arguments_, options] = context.spawnCalls[0];
	t.is(command, process.execPath);
	t.is(path.basename(arguments_[0]), 'check.js');
	t.deepEqual(JSON.parse(arguments_[1]), {
		pkg: {
			name: 'update-notifier-tester',
			version: '0.0.2',
		},
		distTag: 'latest',
		updateCheckInterval: 1,
	});
	t.deepEqual(options, {
		detached: true,
		stdio: 'ignore',
	});
	t.true(context.unrefCalled);
});
