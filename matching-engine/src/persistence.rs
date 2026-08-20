use crate::matcher::{Engine, EngineSnapshot};
use anyhow::{Context, Result};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct SnapshotStore {
    path: PathBuf,
}

impl SnapshotStore {
    pub fn from_env() -> Option<Self> {
        let raw = std::env::var("MATCHING_SNAPSHOT_PATH").ok()?;
        if raw.trim().is_empty() {
            return None;
        }
        Some(Self {
            path: PathBuf::from(raw),
        })
    }

    pub fn load_into(&self, engine: &Engine) -> Result<bool> {
        if !self.path.exists() {
            return Ok(false);
        }
        let bytes = fs::read(&self.path)
            .with_context(|| format!("read snapshot {}", self.path.display()))?;
        let snapshot: EngineSnapshot =
            serde_json::from_slice(&bytes).context("decode matching snapshot")?;
        engine.restore_state(snapshot);
        Ok(true)
    }

    pub fn save(&self, engine: &Engine) -> Result<()> {
        let snapshot = engine.snapshot_state();
        let bytes = serde_json::to_vec(&snapshot).context("encode matching snapshot")?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("create snapshot dir {}", parent.display()))?;
        }
        let tmp = self.path.with_extension("snapshot.tmp");
        let mut file = File::create(&tmp)
            .with_context(|| format!("create temporary snapshot {}", tmp.display()))?;
        file.write_all(&bytes)
            .context("write temporary matching snapshot")?;
        file.sync_all()
            .context("fsync temporary matching snapshot")?;
        fs::rename(&tmp, &self.path)
            .with_context(|| format!("atomically replace snapshot {}", self.path.display()))?;
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(test)]
mod tests {
    use super::SnapshotStore;
    use crate::matcher::{Engine, FeeSchedule};
    use crate::types::{Order, Side, TimeInForce};
    use rust_decimal::Decimal;
    use std::fs;

    #[test]
    fn snapshot_round_trip_preserves_resting_orders_and_sequence() {
        let path =
            std::env::temp_dir().join(format!("rial-matching-snapshot-{}.bin", std::process::id()));
        let _ = fs::remove_file(&path);
        let store = SnapshotStore { path: path.clone() };
        let engine = Engine::new(FeeSchedule::default());
        let order = Order::new_limit(
            "RIAL/TEST",
            "user-1",
            Side::Buy,
            Decimal::new(100, 0),
            Decimal::new(5, 0),
            TimeInForce::Gtc,
        );
        let order_id = order.id.clone();
        let original = engine.submit(order);
        assert_eq!(original.trades.len(), 0);
        assert_eq!(original.order.status, crate::types::OrderStatus::New);
        let original_sequence = engine.market("RIAL/TEST").unwrap().lock().book.sequence;
        store.save(&engine).expect("snapshot must save");

        let restored = Engine::new(FeeSchedule::default());
        assert!(store.load_into(&restored).expect("snapshot must load"));
        let market = restored.market("RIAL/TEST").expect("market restored");
        let market = market.lock();
        assert_eq!(market.book.sequence, original_sequence);
        assert!(market
            .book
            .bids
            .values()
            .flatten()
            .any(|resting| resting.id == order_id));
        let _ = fs::remove_file(path);
    }
}
