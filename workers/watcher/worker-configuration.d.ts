// Generated by Wrangler on Wed Jul 31 2024 23:00:48 GMT-0400 (Eastern Daylight Time)
// by running `wrangler types`

interface Env {
	API_TOKEN: string;
	CACHE_CAPTURE: Queue;
	CACHE_PURGE_TAG: Queue;
}
declare module "*.csv" {
	const value: string;
	export default value;
}
