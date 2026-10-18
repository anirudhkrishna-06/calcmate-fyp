"""Observable-evidence pressure shared with the simulation baseline."""
POLICY_VERSION = "observed-allocation-v1"


def observed_pressure(values):
    return sum(.3 if value is None else max(0., .8 - float(value)) for value in values)
