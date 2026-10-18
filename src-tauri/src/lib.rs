use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create hands table",
        sql: "CREATE TABLE IF NOT EXISTS hands (id TEXT PRIMARY KEY NOT NULL, import_key TEXT NOT NULL UNIQUE, played_at TEXT, payload TEXT NOT NULL)",
        kind: MigrationKind::Up,
    }, Migration {
        version: 2,
        description: "index hands by date",
        sql: "CREATE INDEX IF NOT EXISTS hands_played_at_idx ON hands(played_at)",
        kind: MigrationKind::Up,
    }, Migration {
        version: 3,
        description: "store colored hand tags",
        sql: "CREATE TABLE IF NOT EXISTS hand_tags (hand_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (hand_id, name), FOREIGN KEY (hand_id) REFERENCES hands(id) ON DELETE CASCADE)",
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pokerlab.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running PokerLab");
}
