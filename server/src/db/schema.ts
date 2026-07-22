import { sqliteTable, text, integer, real, primaryKey, index } from "drizzle-orm/sqlite-core";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  url: text("url"),
  username: text("username").notNull(),
  myColor: text("my_color").notNull(),
  result: text("result").notNull(),
  timeClass: text("time_class").notNull(),
  endTime: integer("end_time").notNull(),
  eco: text("eco"),
  openingName: text("opening_name"),
  myRating: integer("my_rating"),
  oppRating: integer("opp_rating"),
  pgn: text("pgn").notNull(),
});

export const moves = sqliteTable(
  "moves",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gameId: text("game_id").notNull(),
    ply: integer("ply").notNull(),
    fenBefore: text("fen_before").notNull(),
    fenAfter: text("fen_after").notNull(),
    epdBefore: text("epd_before").notNull(),
    epdAfter: text("epd_after").notNull(),
    san: text("san").notNull(),
    uci: text("uci").notNull(),
    isMine: integer("is_mine", { mode: "boolean" }).notNull(),
    bookStatus: text("book_status"),
    evalBestCp: integer("eval_best_cp"),
    evalPlayedCp: integer("eval_played_cp"),
    cpLoss: integer("cp_loss"),
    classification: text("classification"),
  },
  (t) => ({ byEpdBefore: index("moves_epd_before_idx").on(t.epdBefore) })
);

export const positionEvals = sqliteTable(
  "position_evals",
  {
    epd: text("epd").notNull(),
    depth: integer("depth").notNull(),
    engineVersion: text("engine_version").notNull(),
    scoreCp: integer("score_cp"),
    mateIn: integer("mate_in"),
    linesJson: text("lines_json").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.epd, t.depth, t.engineVersion] }) })
);

export const bookStats = sqliteTable(
  "book_stats",
  {
    epd: text("epd").notNull(),
    source: text("source").notNull(),
    total: integer("total").notNull(),
    movesJson: text("moves_json").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.epd, t.source] }) })
);

export const openings = sqliteTable("openings", {
  epd: text("epd").primaryKey(),
  eco: text("eco").notNull(),
  name: text("name").notNull(),
});

export const drillAttempts = sqliteTable(
  "drill_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    epd: text("epd").notNull(),               // position the user was asked to move in
    openingEpd: text("opening_epd"),          // the opening the drill started from
    openingName: text("opening_name"),
    color: text("color").notNull(),           // which side the user drilled
    source: text("source").notNull(),         // masters | rating
    playedUci: text("played_uci").notNull(),  // the FIRST-TRY move
    pass: integer("pass", { mode: "boolean" }).notNull(),
    cpLoss: integer("cp_loss"),               // null when unverifiable
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({ byEpd: index("drill_attempts_epd_idx").on(t.epd) })
);

export const drillSchedule = sqliteTable(
  "drill_schedule",
  {
    epd: text("epd").notNull(),                        // position the user moves in
    color: text("color").notNull(),                    // side drilled — a card is (epd, color)
    openingEpd: text("opening_epd"),                   // most-recent opening context, for grouping "due"
    openingName: text("opening_name"),
    easeFactor: real("ease_factor").notNull(),         // SM-2 EF, starts 2.5, floor 1.3
    intervalDays: integer("interval_days").notNull(),
    reps: integer("reps").notNull(),                   // consecutive successful reps
    dueAt: integer("due_at").notNull(),                // epoch seconds; surfaces when due_at <= now
    lastReviewedAt: integer("last_reviewed_at").notNull(),
    lastGrade: integer("last_grade"),                  // 0–5, for display/debug
  },
  (t) => ({
    pk: primaryKey({ columns: [t.epd, t.color] }),
    byDue: index("drill_schedule_due_idx").on(t.dueAt),
  })
);
