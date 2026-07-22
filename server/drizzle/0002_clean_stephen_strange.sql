CREATE TABLE `drill_schedule` (
	`epd` text NOT NULL,
	`color` text NOT NULL,
	`opening_epd` text,
	`opening_name` text,
	`ease_factor` real NOT NULL,
	`interval_days` integer NOT NULL,
	`reps` integer NOT NULL,
	`due_at` integer NOT NULL,
	`last_reviewed_at` integer NOT NULL,
	`last_grade` integer,
	PRIMARY KEY(`epd`, `color`)
);
--> statement-breakpoint
CREATE INDEX `drill_schedule_due_idx` ON `drill_schedule` (`due_at`);