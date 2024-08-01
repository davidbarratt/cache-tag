-- Migration number: 0001 	 2024-07-30T03:10:05.594Z
CREATE TABLE url (
	id TEXT PRIMARY KEY,
	url TEXT UNIQUE
);
CREATE TABLE tag (
	url TEXT REFERENCES url,
	tag TEXT,
	PRIMARY KEY (url, tag)
);
CREATE INDEX tag_idx ON tag(tag);

