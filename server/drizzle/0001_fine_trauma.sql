CREATE TABLE `drill_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`epd` text NOT NULL,
	`opening_epd` text,
	`opening_name` text,
	`color` text NOT NULL,
	`source` text NOT NULL,
	`played_uci` text NOT NULL,
	`pass` integer NOT NULL,
	`cp_loss` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `drill_attempts_epd_idx` ON `drill_attempts` (`epd`);