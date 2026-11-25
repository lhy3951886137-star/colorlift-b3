"""Privileged website teacher for live yaw-planned grasp demonstrations."""
from dataclasses import replace

import numpy as np
from scipy.spatial.transform import Rotation

from colorlift.event_control import EventExecutor, FingerContactSensor, event_config


class DirectionExecutor(EventExecutor):
    def __init__(self, cfg, expert, env):
        super().__init__(cfg, expert, replace(event_config("efficiency"), early_descent=False))
        self.env = env
        self.ready = False
        self.stage = 0
        self.rotation_wait = 0
        self.trace = []
        self.site = next(iter(env.robots[0].eef_site_id.values()))
        self.controller = next(
            controller
            for controller in env.robots[0].part_controllers.values()
            if hasattr(controller, "compute_goal_ori")
        )
        self.original_compute_goal_ori = self.controller.compute_goal_ori

        def measured_goal(delta, goal_update_mode=None):
            previous = self.controller._goal_update_mode
            self.controller._goal_update_mode = "achieved"
            try:
                return self.original_compute_goal_ori(delta, goal_update_mode="achieved")
            finally:
                self.controller._goal_update_mode = previous

        self.controller.compute_goal_ori = measured_goal

    def restore(self):
        self.controller.compute_goal_ori = self.original_compute_goal_ori

    def plan(self, obs):
        target = self.env.sim.data.body_xpos[self.env.color_body_ids[self.env.target_color]].copy()
        others = [
            self.env.sim.data.body_xpos[body_id].copy()
            for color, body_id in self.env.color_body_ids.items()
            if color != self.env.target_color
        ]
        nearest = min(others, key=lambda position: np.linalg.norm(position[:2] - target[:2]))
        neighbor_vector = nearest[:2] - target[:2]
        sensor = FingerContactSensor(self.env)
        jaw_centers = [
            np.mean(self.env.sim.data.geom_xpos[list(ids)], axis=0)
            for ids in sensor.sides
        ]
        jaw_axis = jaw_centers[0] - jaw_centers[1]
        desired_yaw = np.arctan2(neighbor_vector[1], neighbor_vector[0]) + np.pi / 2
        delta = (desired_yaw - np.arctan2(jaw_axis[1], jaw_axis[0]) + np.pi / 2) % np.pi - np.pi / 2
        if np.linalg.norm(neighbor_vector) > 0.09:
            delta = 0.0
        self.start_rotation = self.env.sim.data.site_xmat[self.site].reshape(3, 3).copy()
        self.target_rotation = Rotation.from_rotvec([0, 0, delta]).as_matrix() @ self.start_rotation
        eef = np.asarray(obs["robot0_eef_pos"])
        self.high = max(float(eef[2]), 1.01)
        self.start_xy = eef[:2].copy()
        self.plan_info = {
            "yaw_delta_deg": float(np.degrees(delta)),
            "neighbor_distance_m": float(np.linalg.norm(neighbor_vector)),
            "teacher_uses_object_state": True,
        }
        self.ready = True

    def action(self, obs, requested_phase, xyz, tactile):
        if not self.ready:
            self.plan(obs)
        eef = np.asarray(obs["robot0_eef_pos"])
        current_rotation = self.env.sim.data.site_xmat[self.site].reshape(3, 3).copy()
        desired_rotation = self.start_rotation if self.stage == 0 else self.target_rotation
        error = Rotation.from_matrix(desired_rotation @ current_rotation.T).as_rotvec()
        angle = float(np.linalg.norm(error))

        if self.stage == 0 and abs(eef[2] - self.high) < 0.006:
            self.stage = 1
        if self.stage == 1:
            self.rotation_wait = self.rotation_wait + 1 if angle < 0.035 else 0
            if self.rotation_wait >= 3:
                self.stage = 2
        if self.stage == 2 and np.linalg.norm(eef[:2] - np.asarray(xyz)[:2]) < 0.004 and abs(eef[2] - self.high) < 0.006:
            self.stage = 3

        if self.stage < 3:
            goal = np.r_[self.start_xy if self.stage < 2 else np.asarray(xyz)[:2], self.high]
            translation = goal - eef
            distance = np.linalg.norm(translation)
            if distance > 0.025:
                translation *= 0.025 / distance
            grip = -1.0 if abs(obs["robot0_gripper_qpos"]).sum() < self.expert.open_gap else 0.0
            action = np.r_[translation / 0.05, np.zeros(3), grip]
            self.phase_steps += 1
            control = {
                "phase": 0,
                "requested_phase": 0,
                "close_steps": 0,
                "goal_xyz": goal,
                "command_translation_m": translation.copy(),
                "transition_event": f"direction_high_{self.stage}",
                "phase_changed": False,
                "predicted_xy_error_m": float(np.linalg.norm(eef[:2] - np.asarray(xyz)[:2])),
            }
        else:
            action, control = super().action(obs, requested_phase, xyz, tactile)

        desired_rotation = self.start_rotation if self.stage == 0 else self.target_rotation
        rotation_error = Rotation.from_matrix(desired_rotation @ current_rotation.T).as_rotvec()
        if self.controller.input_ref_frame == "base":
            rotation_error = self.controller.origin_ori.T @ rotation_error
        norm = np.linalg.norm(rotation_error)
        if norm > 0.05:
            rotation_error *= 0.05 / norm
        action[3:6] = rotation_error / np.asarray(self.controller.output_max)[3:6]
        self.trace.append(
            {
                "stage": self.stage,
                "angle_error_deg": float(np.degrees(angle)),
                "eef_xyz": eef.tolist(),
                "phase": control["phase"],
                "rotation_action": action[3:6].tolist(),
            }
        )
        return action, control
