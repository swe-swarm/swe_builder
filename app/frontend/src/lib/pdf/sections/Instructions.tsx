import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { colors } from "../styles";
import { SectionHeading, CodeBlock, Divider } from "../primitives";

interface Props {
  data: any;
}

const Instructions = ({ data }: Props) => {
  if (!data?.systemPrompt) return null;
  return (
    <View>
      <SectionHeading
        title="Instructions"
        subtitle={`System prompt defining agent behavior (${data.systemPrompt.length} chars)`}
      />
      <CodeBlock>{data.systemPrompt}</CodeBlock>
      <Divider />
    </View>
  );
};

export default Instructions;
