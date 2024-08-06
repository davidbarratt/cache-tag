-- Migration number: 0001 	 2024-07-30T03:10:05.594Z
CREATE TABLE url (
	id TEXT PRIMARY KEY,
	zone TEXT NOT NULL,
	value TEXT UNIQUE NOT NULL
);
CREATE INDEX url_zone_idx ON url(zone);

CREATE TABLE tag (
	url TEXT REFERENCES url,
	value TEXT NOT NULL,
	PRIMARY KEY (url, value)
);
CREATE INDEX tag_idx ON tag(value);

