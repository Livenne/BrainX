package com.brainx.server.core;

import java.util.Optional;

public interface BrainxStateStore {
  Optional<BrainxStateSnapshot> load();

  void save(BrainxStateSnapshot snapshot);
}
