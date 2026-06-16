CREATE TABLE `book_stats` (
	`epd` text NOT NULL,
	`source` text NOT NULL,
	`total` integer NOT NULL,
	`moves_json` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`epd`, `source`)
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`url` text,
	`username` text NOT NULL,
	`my_color` text NOT NULL,
	`result` text NOT NULL,
	`time_class` text NOT NULL,
	`end_time` integer NOT NULL,
	`eco` text,
	`opening_name` text,
	`my_rating` integer,
	`opp_rating` integer,
	`pgn` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `moves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` text NOT NULL,
	`ply` integer NOT NULL,
	`fen_before` text NOT NULL,
	`fen_after` text NOT NULL,
	`epd_before` text NOT NULL,
	`epd_after` text NOT NULL,
	`san` text NOT NULL,
	`uci` text NOT NULL,
	`is_mine` integer NOT NULL,
	`book_status` text,
	`eval_best_cp` integer,
	`eval_played_cp` integer,
	`cp_loss` integer,
	`classification` text
);
--> statement-breakpoint
CREATE INDEX `moves_epd_before_idx` ON `moves` (`epd_before`);--> statement-breakpoint
CREATE TABLE `openings` (
	`epd` text PRIMARY KEY NOT NULL,
	`eco` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `position_evals` (
	`epd` text NOT NULL,
	`depth` integer NOT NULL,
	`engine_version` text NOT NULL,
	`score_cp` integer,
	`mate_in` integer,
	`lines_json` text NOT NULL,
	PRIMARY KEY(`epd`, `depth`, `engine_version`)
);
