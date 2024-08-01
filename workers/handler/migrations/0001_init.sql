-- Migration number: 0001 	 2024-07-30T03:10:05.594Z
CREATE TABLE url (
	id TEXT PRIMARY KEY,
	value TEXT UNIQUE
);
CREATE TABLE tag (
	url TEXT REFERENCES url,
	value TEXT,
	PRIMARY KEY (url, value)
);
CREATE INDEX tag_idx ON tag(value);

