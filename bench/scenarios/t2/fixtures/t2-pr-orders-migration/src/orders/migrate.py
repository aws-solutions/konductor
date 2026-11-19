"""
Migration runner for schema changes.
"""

import argparse
import importlib
import sys
from pathlib import Path
from typing import List, Optional

from .database import Database


class MigrationRunner:
    """Manages migration execution."""
    
    def __init__(self, db: Database):
        self.db = db
        self._ensure_migrations_table()
    
    def _ensure_migrations_table(self):
        """Create the migrations tracking table if it doesn't exist."""
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        self.db.commit()
    
    def get_applied_migrations(self) -> List[str]:
        """Get list of already applied migrations."""
        cursor = self.db.execute("SELECT version FROM schema_migrations ORDER BY version")
        return [row[0] for row in cursor.fetchall()]
    
    def find_migration_files(self) -> List[str]:
        """Find all migration files in the migrations directory."""
        migrations_dir = Path(__file__).parent / "migrations"
        if not migrations_dir.exists():
            return []
        
        files = []
        for file in migrations_dir.glob("*.py"):
            if file.name.startswith("migration_"):
                files.append(file.stem)
        
        return sorted(files)
    
    def apply_migration(self, migration_name: str, direction: str = "up"):
        """Apply a single migration in the specified direction."""
        try:
            # Import the migration module
            module_name = f"src.orders.migrations.{migration_name}"
            module = importlib.import_module(module_name)
            
            # Get the migration function
            func = getattr(module, direction, None)
            if func is None:
                raise ValueError(f"Migration {migration_name} has no {direction} function")
            
            # Run the migration
            func(self.db)
            self.db.commit()
            
            # Record the migration
            if direction == "up":
                self.db.execute(
                    "INSERT INTO schema_migrations (version) VALUES (?)",
                    (migration_name,)
                )
            else:
                self.db.execute(
                    "DELETE FROM schema_migrations WHERE version = ?",
                    (migration_name,)
                )
            self.db.commit()
            
            print(f"✓ {migration_name} {direction}")
            
        except Exception as e:
            self.db.rollback()
            print(f"✗ {migration_name} {direction} failed: {e}")
            raise
    
    def run(self, direction: str = "up", target: Optional[str] = None):
        """Run migrations in the specified direction."""
        migrations = self.find_migration_files()
        applied = self.get_applied_migrations()
        
        if direction == "up":
            to_apply = [m for m in migrations if m not in applied]
            if target:
                to_apply = [m for m in to_apply if m <= target]
            
            for migration in to_apply:
                self.apply_migration(migration, "up")
                
        elif direction == "down":
            to_revert = [m for m in reversed(applied)]
            if target:
                try:
                    idx = to_revert.index(target)
                    to_revert = to_revert[:idx+1]
                except ValueError:
                    print(f"Target migration {target} not found in applied migrations")
                    return
            
            for migration in to_revert:
                self.apply_migration(migration, "down")
        else:
            raise ValueError(f"Invalid direction: {direction}")


def main():
    """Command-line interface for migration runner."""
    parser = argparse.ArgumentParser(description="Run database migrations")
    parser.add_argument("--direction", choices=["up", "down"], default="up",
                       help="Migration direction (up or down)")
    parser.add_argument("--target", help="Target migration version")
    parser.add_argument("--db", default="orders.db", help="Database file path")
    
    args = parser.parse_args()
    
    db = Database(args.db)
    runner = MigrationRunner(db)
    
    try:
        runner.run(args.direction, args.target)
    except Exception as e:
        print(f"Migration failed: {e}")
        sys.exit(1)
    finally:
        db.disconnect()


if __name__ == "__main__":
    main()