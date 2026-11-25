"""Pure protocol checks; no CUDA/MuJoCo imports required."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location("robot_service",Path(__file__).with_name("robot_service.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.scene={"target":"yellow","cubes":[{"color":"blue","x":-.08,"y":0.,"yaw":.3},
                    {"color":"red","x":0.,"y":.08,"yaw":0.},{"color":"yellow","x":.08,"y":0.,"yaw":0.}]}

    def test_coordinates_and_color_slot_are_preserved(self):
        result=module.validate_scene(self.scene)
        self.assertEqual(result["cubes"],self.scene["cubes"])
        self.assertEqual(result["target"],"yellow")

    def test_nan_bool_duplicate_outside_and_overlap_are_rejected(self):
        for key,value in (("x",float("nan")),("x",True),("x",.146),("color","red")):
            scene=copy.deepcopy(self.scene)
            scene["cubes"][0][key]=value
            with self.assertRaises(ValueError):module.validate_scene(scene)
        scene=copy.deepcopy(self.scene)
        scene["cubes"][2].update(x=-.08,y=0.)
        with self.assertRaises(ValueError):module.validate_scene(scene)

    def test_touching_allowed_only_for_direction_teacher_and_overlap_always_rejected(self):
        scene=copy.deepcopy(self.scene)
        scene["cubes"][0].update(x=0.,y=0.,yaw=0.)
        scene["cubes"][2].update(x=.04,y=0.,yaw=0.)
        with self.assertRaisesRegex(ValueError,"贴边"):
            module.validate_scene(scene)
        self.assertEqual(module.validate_scene(scene,allow_touching=True)["cubes"],scene["cubes"])
        scene["cubes"][2]["x"]=.039
        with self.assertRaisesRegex(ValueError,"重叠"):
            module.validate_scene(scene,allow_touching=True)

    def test_stream_keeps_latest_frame_and_final_result(self):
        run=module.Run(self.scene)
        run.publish({"step":1})
        run.publish({"step":2})
        run.finish({"status":"cancelled","success":None})
        self.assertEqual(run.frame,{"step":2})
        self.assertEqual(run.sequence,2)
        self.assertIsNone(run.result["success"])

    def test_controller_source_is_separate_from_b3(self):
        self.assertEqual(module.Run(self.scene,"b3").source,"model")
        self.assertEqual(module.Run(self.scene,"direction").source,"expert")
        self.assertEqual(module.Service.normalize_controller("direction"),"direction")
        with self.assertRaises(ValueError):
            module.Service.normalize_controller("other")

    def test_edge_contact_scene_is_only_valid_for_direction_teacher(self):
        touching={"target":"red","cubes":[
            {"color":"red","x":0.,"y":0.,"yaw":0.},
            {"color":"yellow","x":.04,"y":0.,"yaw":0.},
            {"color":"blue","x":0.,"y":.12,"yaw":0.}]}
        with self.assertRaisesRegex(ValueError,"贴边"):
            module.validate_scene(touching)
        self.assertEqual(len(module.validate_scene(touching,allow_touching=True)["cubes"]),3)
        overlap={**touching,"cubes":[*touching["cubes"]]}
        overlap["cubes"][1]={**overlap["cubes"][1],"x":.039}
        with self.assertRaisesRegex(ValueError,"重叠"):
            module.validate_scene(overlap,allow_touching=True)


if __name__=="__main__":unittest.main()
