"""Named synthetic rolls used by the tests (and ``roll-parser synth``)."""

from pydantic import BaseModel, ConfigDict

from roll_parser.synthetic.data import RollSpec
from roll_parser.synthetic.render import Degradation


class Preset(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    description: str
    spec: RollSpec
    degradation: Degradation = Degradation()


PRESETS = {
    p.name: p
    for p in [
        Preset(
            name="small",
            description=(
                "5 pages, 2 sections, 1 auxiliary station, deleted and modified entries, "
                "third gender, long names. Committed as a fixture."
            ),
            spec=RollSpec(
                seed=1,
                section_sizes=[24, 18],
                auxiliary_stations=1,
                deleted=2,
                modified=1,
                third_gender=1,
                long_name_share=0.25,
            ),
            degradation=Degradation(jpeg_quality=75),  # keeps the committed file small
        ),
        Preset(
            name="small-framed",
            description=(
                "Like small, with the serial frame in the box corner and the EPIC framed: "
                "a different geometry for the serial/EPIC row."
            ),
            spec=RollSpec(seed=2, section_sizes=[24, 18], box_style="framed"),
            degradation=Degradation(jpeg_quality=75, blur_sigma=0.5, noise_sigma=4),
        ),
        Preset(
            name="ac40",
            description="Like the owner's AC 40 sample: 23 pages, 571 electors, 2 sections.",
            spec=RollSpec(seed=40, section_sizes=[300, 271], rare_epic_prefixes=2),
        ),
        Preset(
            name="ac40-degraded",
            description="The ac40 roll, blurred, slightly rotated, noisy and at JPEG quality 60.",
            spec=RollSpec(seed=40, section_sizes=[300, 271], rare_epic_prefixes=2),
            degradation=Degradation(
                jpeg_quality=60, blur_sigma=0.8, max_rotation_deg=0.4, noise_sigma=6
            ),
        ),
    ]
}
